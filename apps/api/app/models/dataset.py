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
    std: float


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
    missing_count: int
    missing_pct: float
    unique_count: int
    numeric_stats: NumericStats | None
    categorical_summary: CategoricalSummary | None
    date_range: DateRange | None


class DatasetProfile(BaseModel):
    dataset_id: str
    filename: str
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    duplicate_row_count: int
    warnings: list[str]
    generated_at: datetime


class DatasetPreview(BaseModel):
    dataset_id: str
    columns: list[str]
    rows: list[dict[str, str | float | int | None]] = Field(..., max_length=10)
