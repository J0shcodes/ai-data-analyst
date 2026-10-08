from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal


class ValueCount(BaseModel):
    value: str
    count: int


class NumericStats(BaseModel):
    min: float
    max: float
    mean: float
    median: float
    std: float = Field(ge=0)


class CategoricalSummary(BaseModel):
    top_values: list[ValueCount] = Field(..., max_length=8)
    cardinality_flag: Literal["low", "medium", "high"]


class DateRange(BaseModel):
    min: datetime
    max: datetime


class ColumnProfile(BaseModel):
    name: str
    original_name: str
    inferred_type: Literal["numeric", "categorical", "datetime", "boolean", "text"]
    missing_count: int = Field(ge=0)
    missing_pct: float = Field(ge=0, le=100)
    unique_count: int = Field(ge=0)
    numeric_stats: NumericStats | None
    categorical_summary: CategoricalSummary | None
    date_range: DateRange | None


class DatasetProfile(BaseModel):
    dataset_id: str
    filename: str
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    columns: list[ColumnProfile]
    duplicate_row_count: int = Field(ge=0)
    warnings: list[str] = Field(
        default_factory=list,
        description="High-level data health or structure warnings for the LLM",
    )
    generated_at: datetime


class DatasetPreview(BaseModel):
    dataset_id: str
    columns: list[str]
    rows: list[dict[str, str | float | int | None]] = Field(..., max_length=10)

class DatasetSummary(BaseModel):
    dataset_id: str
    filename: str
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    created_at: datetime
    last_accessed_at: datetime
