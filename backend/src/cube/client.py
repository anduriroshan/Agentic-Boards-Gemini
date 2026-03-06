import httpx

from src.config import settings
from src.cube.models import CubeMeta, CubeQuery


class CubeClient:
    """Async client for the Cube.js REST API."""

    def __init__(self):
        self.base_url = settings.cubejs_api_url
        self.api_secret = settings.cubejs_api_secret

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_secret:
            headers["Authorization"] = self.api_secret
        return headers

    async def get_meta(self) -> list[CubeMeta]:
        """Fetch all cube metadata (measures, dimensions)."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/meta",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        cubes = []
        for cube_data in data.get("cubes", []):
            cubes.append(CubeMeta(
                name=cube_data.get("name", ""),
                title=cube_data.get("title", ""),
                measures=[
                    {
                        "name": m.get("name", ""),
                        "title": m.get("title", ""),
                        "type": m.get("type", ""),
                        "short_title": m.get("shortTitle", ""),
                        "description": m.get("description", ""),
                    }
                    for m in cube_data.get("measures", [])
                ],
                dimensions=[
                    {
                        "name": d.get("name", ""),
                        "title": d.get("title", ""),
                        "type": d.get("type", ""),
                        "short_title": d.get("shortTitle", ""),
                        "description": d.get("description", ""),
                    }
                    for d in cube_data.get("dimensions", [])
                ],
            ))
        return cubes

    async def load(self, query: dict) -> dict:
        """Execute a Cube.js query and return results."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.base_url}/load",
                json={"query": query},
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def sql(self, query: dict) -> str:
        """Get the generated SQL for a Cube.js query."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/sql",
                json={"query": query},
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("sql", {}).get("sql", [""])[0]
