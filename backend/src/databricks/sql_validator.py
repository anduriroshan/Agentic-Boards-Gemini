import re
import logging

logger = logging.getLogger(__name__)

class InvalidSQLError(ValueError):
    """Raised when a SQL query contains blocked keywords."""
    pass

def validate_sql_read_only(sql: str) -> None:
    """
    Validates that a SQL string is read-only.
    Raises InvalidSQLError if the query is a write/DDL operation.
    """
    _blocked = {
        "insert", "update", "delete", "drop", "create", "alter",
        "truncate", "merge", "replace", "upsert",
        "grant", "revoke", "call", "exec", "execute",
        "copy", "load", "put", "get",
    }
    _allowed_starts = {"select", "with", "show", "describe", "desc", "explain"}

    # Remove single-line (--) and multi-line (/* */) SQL comments
    _sql_clean = re.sub(r"--[^\n]*", " ", sql)
    _sql_clean = re.sub(r"/\*.*?\*/", " ", _sql_clean, flags=re.DOTALL)
    
    # Extract the first word (the statement verb)
    tokens = re.split(r"\s+", _sql_clean.strip(), maxsplit=1)
    if not tokens or not tokens[0]:
        raise InvalidSQLError("Empty SQL statement.")
        
    _first_token = tokens[0].lower().rstrip(";")

    if _first_token in _blocked:
        logger.warning("BLOCKED write/DDL statement: %s", _first_token.upper())
        raise InvalidSQLError(
            f"BLOCKED: '{_first_token.upper()}' statements are not allowed. "
            "Only read-only queries (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) are permitted."
        )

    if _first_token not in _allowed_starts:
        logger.warning("BLOCKED unknown statement verb: %s", _first_token)
        raise InvalidSQLError(
            f"BLOCKED: Unrecognised SQL verb '{_first_token}'. "
            "Only SELECT, WITH, SHOW, DESCRIBE, and EXPLAIN are permitted."
        )
