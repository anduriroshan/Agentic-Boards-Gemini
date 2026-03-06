from dataclasses import dataclass


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] | None = None


def validate_output(node_name: str, output: dict) -> ValidationResult:
    """Placeholder validator. Always returns valid.

    Future: validate Vega-Lite specs against JSON schema,
    check SQL for dangerous operations, etc.
    """
    return ValidationResult(valid=True)
