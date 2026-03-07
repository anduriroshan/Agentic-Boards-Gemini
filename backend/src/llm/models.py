from pydantic import BaseModel


class GenAIExample(BaseModel):
    user_input: str
    ai_output: str


class GenAIRequest(BaseModel):
    context: str = ""
    question: str = ""
    callbackurl: str = ""
    example: list[GenAIExample] = []


class GenAIResponse(BaseModel):
    """Raw response from the GenAI gateway.
    The actual shape may vary; this captures the text answer."""

    answer: str
    raw: dict = {}
