from pydantic import BaseModel


class CubeQuery(BaseModel):
    measures: list[str] = []
    dimensions: list[str] = []
    time_dimensions: list[dict] = []
    filters: list[dict] = []
    order: dict = {}
    limit: int = 100


class CubeMember(BaseModel):
    name: str
    title: str
    type: str
    short_title: str = ""
    description: str = ""


class CubeMeta(BaseModel):
    name: str
    title: str
    measures: list[CubeMember] = []
    dimensions: list[CubeMember] = []
