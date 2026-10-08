from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal


class Insights(BaseModel):
    title: str
    description: str
    importance: Literal["high", "medium", "low"]
    supporting_metric: str | None


class Metrics(BaseModel):
    label: str = Field(description="The display name of the metric")
    value: float | int | str = Field(
        description="The actual calculated metric value"
    )
    unit: str | None = Field(
        default=None,
        description="The units of the metric, e.g. 'USD', '%', or null for counts",
    )
    context: str | None = Field(
        default=None,
        description="Free text short context or benchmark, e.g. 'vs. previous month'",
    )


class AxisConfig(BaseModel):
    key: str = Field(description="The property key inside the data array entries")
    label: str = Field(description="The human-readable label for the axis")


class Visualization(BaseModel):
    type: Literal["bar", "line", "area", "pie", "scatter"]
    title: str
    x_axis: AxisConfig


class Metadata(BaseModel):
    pass


class AnalysisResult(BaseModel):
    summary: str
    insights: list[Insights]
    metrics: list[Metrics]
    visualization: list[Visualization]
    metadata: Metadata
