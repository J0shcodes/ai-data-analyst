from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal, Union


class Insight(BaseModel):
    title: str
    description: str
    importance: Literal["high", "medium", "low"]
    supporting_metric: str | None


class Metrics(BaseModel):
    label: str = Field(description="The display name of the metric")
    value: float | int | str = Field(description="The actual calculated metric value")
    unit: str | None = Field(
        default=None,
        description="The units of the metric, e.g. 'USD', '%', or null for counts",
    )
    context: str | None = Field(
        default=None,
        description="Free text short context or benchmark, e.g. 'vs. previous month'",
    )


class SeriesConfig(BaseModel):
    key: str = Field(description="The property key corresponding to this data series")
    label: str = Field(description="The human-readable label for this series")


class FormattingConfig(BaseModel):
    value_format: Literal["number", "currency", "percent"]


class AxisConfig(BaseModel):
    key: str = Field(description="The property key inside the data array entries")
    label: str = Field(description="The human-readable label for the axis")


class Visualization(BaseModel):
    type: Literal["bar", "line", "area", "pie", "scatter"]
    title: str
    x_axis: AxisConfig
    y_axis: AxisConfig
    series: list[SeriesConfig] = Field(
        description="List of 1 to n series configs for multi-series rendering"
    )
    data: list[dict[str, float | int | str]] = Field(
        description="Rows of chart data keyed by x_axis.key and series keys"
    )
    formatting: FormattingConfig | None


class Metadata(BaseModel):
    tools_used: list[str] = Field(
        description="Names of tools or plugins invoked to compute this answer"
    )
    dataset_id: str = Field(description="The unique identifier of the source dataset")
    confidence_note: str | None = Field(
        description="Optional caveat, e.g. 'based on only 12 rows after filtering'"
    )


class AnalysisResult(BaseModel):
    summary: str
    insights: list[Insight]
    metrics: list[Metrics]
    visualization: list[Visualization]
    metadata: Metadata
