"""
Databricks Connector — dual-mode singleton manager.

Automatically selects the connection method based on available configuration:

  • SQL Warehouse mode  — set DATABRICKS_HTTP_PATH (e.g. /sql/1.0/warehouses/<id>)
    Uses ``databricks-sql-connector`` (pip install databricks-sql-connector).
    Ideal for serverless SQL Warehouses on personal/free accounts.

  • Spark / Cluster mode — set DATABRICKS_CLUSTER_ID
    Uses ``databricks-connect`` + PySpark (pip install databricks-connect).
    Requires an interactive cluster; takes 2-3 min to cold-start.

Priority: HTTP_PATH wins if both are set.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional

from src.config import settings

logger = logging.getLogger(__name__)

# ── Module-level singleton ────────────────────────────────────
_manager: Optional["DatabricksManager"] = None
_lock = threading.Lock()


def get_databricks_manager() -> "DatabricksManager":
    """Return the process-wide DatabricksManager (create on first call)."""
    global _manager
    if _manager is None:
        with _lock:
            if _manager is None:
                _manager = DatabricksManager()
    return _manager


# ── Connection-mode helpers ───────────────────────────────────

def _resolve_mode() -> str:
    """Return 'sql' if HTTP_PATH is available, 'spark' if CLUSTER_ID is available, else 'none'."""
    if settings.databricks_http_path:
        return "sql"
    if settings.databricks_cluster_id:
        return "spark"
    return "none"


# ── Main manager class ────────────────────────────────────────

class DatabricksManager:
    """Dual-mode Databricks connection manager.

    Lazily connects on the first data call and exposes a uniform interface
    regardless of whether the underlying transport is a SQL Warehouse or a
    Spark cluster.
    """

    def __init__(self) -> None:
        # Spark mode internals
        self._spark: Any = None  # pyspark.sql.SparkSession
        # SQL mode internals
        self._sql_conn: Any = None  # databricks.sql.client.Connection

        self._lock = threading.Lock()
        self._connecting = False
        self._connected_at: Optional[float] = None
        self._mode: str = _resolve_mode()  # 'sql' | 'spark' | 'none'

        # Configurable defaults
        self.catalog: str = settings.databricks_catalog
        self.schema: str = settings.databricks_schema
        self.default_table: str = settings.databricks_default_table

    # ── Status ────────────────────────────────────────────────

    @property
    def is_connected(self) -> bool:
        if self._mode == "sql":
            return self._sql_conn is not None
        return self._spark is not None

    @property
    def status(self) -> Dict[str, Any]:
        return {
            "connected": self.is_connected,
            "connecting": self._connecting,
            "connected_at": self._connected_at,
            "mode": self._mode,
            "catalog": self.catalog,
            "schema": self.schema,
            "default_table": self.default_table,
            "spark_version": self._spark.version if self._spark else None,
        }

    # ── Connection management ─────────────────────────────────

    def connect(
        self,
        *,
        host: Optional[str] = None,
        token: Optional[str] = None,
        # SQL Warehouse params
        http_path: Optional[str] = None,
        # Spark / cluster params
        cluster_id: Optional[str] = None,
        catalog: Optional[str] = None,
        schema: Optional[str] = None,
    ) -> Any:
        """Connect using whichever credentials are available.

        Returns a SparkSession (Spark mode) or a SQL Connection (SQL mode).
        Priority: explicit ``http_path`` → env HTTP_PATH → explicit ``cluster_id`` → env CLUSTER_ID.
        """
        if self.is_connected:
            logger.info("Reusing existing Databricks connection (mode=%s)", self._mode)
            return self._spark or self._sql_conn

        with self._lock:
            if self.is_connected:
                return self._spark or self._sql_conn

            self._connecting = True
            try:
                resolved_host = (host or settings.databricks_host).replace(
                    "https://", ""
                ).replace("http://", "")
                resolved_token = token or settings.databricks_token

                if not resolved_host:
                    raise ValueError("DATABRICKS_HOST is not set. Check your .env file.")
                if not resolved_token:
                    raise ValueError("DATABRICKS_TOKEN is not set. Check your .env file.")

                # Determine mode from runtime args first, then env
                resolved_http_path = http_path or settings.databricks_http_path
                resolved_cluster_id = cluster_id or settings.databricks_cluster_id

                if resolved_http_path:
                    self._mode = "sql"
                    return self._connect_sql(
                        host=resolved_host,
                        token=resolved_token,
                        http_path=resolved_http_path,
                        catalog=catalog or self.catalog,
                        schema=schema or self.schema,
                    )
                elif resolved_cluster_id:
                    self._mode = "spark"
                    return self._connect_spark(
                        host=resolved_host,
                        token=resolved_token,
                        cluster_id=resolved_cluster_id,
                        catalog=catalog or self.catalog,
                        schema=schema or self.schema,
                    )
                else:
                    raise ValueError(
                        "No Databricks connection method found. "
                        "Set DATABRICKS_HTTP_PATH (SQL Warehouse) or "
                        "DATABRICKS_CLUSTER_ID (Spark cluster) in your .env file."
                    )
            finally:
                self._connecting = False

    def _connect_sql(
        self,
        host: str,
        token: str,
        http_path: str,
        catalog: str,
        schema: str,
    ) -> Any:
        """Establish a SQL Warehouse connection via databricks-sql-connector."""
        try:
            import databricks.sql as dbsql  # type: ignore[import-untyped]
        except ImportError as e:
            raise ImportError(
                "databricks-sql-connector is not installed. "
                "Run: pip install databricks-sql-connector"
            ) from e

        logger.info(
            "Connecting to Databricks SQL Warehouse (http_path=%s) …", http_path
        )
        t0 = time.time()
        conn = dbsql.connect(
            server_hostname=host,
            http_path=http_path,
            access_token=token,
            catalog=catalog or None,
            schema=schema or None,
        )
        self._sql_conn = conn
        self._connected_at = time.time()
        logger.info("Connected to SQL Warehouse in %.1f s", time.time() - t0)
        return conn

    def _connect_spark(
        self,
        host: str,
        token: str,
        cluster_id: str,
        catalog: str,
        schema: str,
    ) -> Any:
        """Establish a Spark session via databricks-connect."""
        try:
            from databricks.connect import DatabricksSession  # type: ignore[import-untyped]
        except ImportError as e:
            raise ImportError(
                "databricks-connect is not installed. "
                "Run: pip install databricks-connect"
            ) from e

        logger.info(
            "Creating Databricks SparkSession (cluster=%s) — this may take 2-3 min …",
            cluster_id,
        )
        t0 = time.time()
        spark = (
            DatabricksSession.builder.remote(
                host=f"https://{host}",
                token=token,
                cluster_id=cluster_id,
            )
            .getOrCreate()
        )
        elapsed = time.time() - t0
        logger.info("Connected to Databricks Spark %s in %.1f s", spark.version, elapsed)
        self._set_catalog_schema(spark, catalog, schema)
        self._spark = spark
        self._connected_at = time.time()
        return spark

    def disconnect(self) -> None:
        """Close the active connection."""
        with self._lock:
            if self._sql_conn:
                try:
                    self._sql_conn.close()
                    logger.info("Disconnected from SQL Warehouse")
                except Exception as exc:
                    logger.error("Error closing SQL connection: %s", exc)
                self._sql_conn = None
            if self._spark:
                try:
                    self._spark.stop()
                    logger.info("Disconnected from Databricks Spark")
                except Exception as exc:
                    logger.error("Error stopping SparkSession: %s", exc)
                self._spark = None
            self._connected_at = None

    def reconnect(self, **kwargs: Any) -> Any:
        """Force-disconnect and create a fresh connection."""
        self.disconnect()
        return self.connect(**kwargs)

    # ── Query helpers (uniform API) ───────────────────────────

    def query(self, sql: str) -> List[Dict[str, Any]]:
        """Execute SQL and return rows as a list of dicts.

        Works for both SQL Warehouse and Spark modes.
        """
        if not self.is_connected:
            self.connect()

        logger.info("Executing SQL: %.120s …", sql)
        t0 = time.time()
        try:
            if self._mode == "sql":
                return self._query_sql(sql)
            else:
                return self._query_spark(sql)
        finally:
            logger.info("Query completed in %.2f s", time.time() - t0)

    def _query_sql(self, sql: str) -> List[Dict[str, Any]]:
        """Run a SQL query using a fresh cursor (avoids Thrift corruption on retry)."""
        cursor = self._sql_conn.cursor()
        try:
            cursor.execute(sql)
            cols = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            result = [dict(zip(cols, row)) for row in rows]
            logger.info("SQL Warehouse returned %d rows", len(result))
            return result
        finally:
            try:
                cursor.close()
            except Exception:
                pass

    def _query_spark(self, sql: str) -> List[Dict[str, Any]]:
        df = self._spark.sql(sql)
        rows = df.collect()
        cols = df.columns
        result = [dict(zip(cols, row)) for row in rows]
        logger.info("Spark returned %d rows", len(result))
        return result

    def query_pandas(self, sql: str) -> Any:
        """Execute SQL and return a pandas DataFrame."""
        import pandas as pd  # noqa: F401

        if not self.is_connected:
            self.connect()

        if self._mode == "sql":
            cursor = self._sql_conn.cursor()
            try:
                cursor.execute(sql)
                cols = [desc[0] for desc in cursor.description] if cursor.description else []
                rows = cursor.fetchall()
                return pd.DataFrame(rows, columns=cols)
            finally:
                try:
                    cursor.close()
                except Exception:
                    pass
        else:
            return self._spark.sql(sql).toPandas()

    def list_tables(
        self, catalog: Optional[str] = None, schema: Optional[str] = None
    ) -> List[str]:
        """Return table names in the given catalog.schema."""
        cat = catalog or self.catalog
        sch = schema or self.schema
        rows = self.query(f"SHOW TABLES IN {cat}.{sch}")
        tables = [f"{cat}.{sch}.{r.get('tableName', r.get('table_name', ''))}" for r in rows]
        logger.info("Found %d tables in %s.%s", len(tables), cat, sch)
        return tables

    def read_table(
        self, table_name: Optional[str] = None, limit: int = 100_000
    ) -> List[Dict[str, Any]]:
        """Read a table and return rows as a list of dicts."""
        table_name = table_name or self.default_table
        logger.info("Reading table: %s (limit=%d)", table_name, limit)
        return self.query(f"SELECT * FROM {table_name} LIMIT {limit}")

    def to_pandas(self, sql_or_table: str, is_table: bool = False) -> Any:
        """Convenience wrapper — pass a SQL string or table name."""
        if is_table:
            sql_or_table = f"SELECT * FROM {sql_or_table}"
        return self.query_pandas(sql_or_table)

    def set_default_table(self, table: str) -> None:
        """Update the default table at runtime."""
        self.default_table = table
        logger.info("Default table set to: %s", table)

    # ── Spark-only helpers ────────────────────────────────────

    @property
    def spark(self) -> Any:
        """Return the SparkSession (raises if in SQL mode)."""
        if self._mode == "sql":
            raise RuntimeError(
                "spark property is unavailable in SQL Warehouse mode. "
                "Use .query() or .query_pandas() instead."
            )
        if self._spark is None:
            self.connect()
        return self._spark

    # ── Internal helpers ──────────────────────────────────────

    @staticmethod
    def _set_catalog_schema(spark: Any, catalog: str, schema: str) -> None:
        try:
            catalogs = spark.sql("SHOW CATALOGS").collect()
            available = [row.catalog for row in catalogs]
            if catalog in available:
                spark.sql(f"USE CATALOG {catalog}")
                if schema:
                    spark.sql(f"USE SCHEMA {schema}")
                logger.info("Set default to: %s.%s", catalog, schema)
            else:
                logger.warning(
                    "Catalog '%s' not found (available: %s)", catalog, available
                )
        except Exception as exc:
            logger.warning("Unity Catalog not available: %s", exc)
