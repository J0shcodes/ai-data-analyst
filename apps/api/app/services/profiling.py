from datetime import datetime, timezone
import pandas as pd

from models.dataset import (
    CategoricalSummary,
    ColumnProfile,
    DatasetProfile,
    DateRange,
    NumericStats,
    ValueCount,
)


def infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if pd.api.types.is_numeric_dtype(series):
        return "numeric"

    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    # Try datetime inference for object/string columns
    if pd.api.types.is_object_dtype(series):
        parsed = pd.to_datetime(series, errors="coerce")

        if parsed.notna().mean() >= 0.8:
            return "datetime"

    # Low-cardinality object columns are treated as categorical
    unique_count = series.dropna().nunique()

    if unique_count <= min(20, max(2, len(series) * 0.05)):
        return "categorical"

    return "text"


def cardinality_flag(unique_count: int, row_count: int) -> str:
    if row_count == 0:
        return "low"

    ratio = unique_count / row_count

    if ratio <= 0:
        return "low"

    if ratio <= 0.05:
        return "medium"

    return "high"


def build_numeric_stats(series: pd.Series) -> NumericStats:
    values = series.dropna()

    return NumericStats(
        min=float(values.min()),
        max=float(values.max()),
        mean=float(values.mean()),
        median=float(values.median()),
        std=float(values.std()) if len(values) > 1 else 0.0,
    )


def build_categorical_summary(series: pd.Series) -> CategoricalSummary:
    value_counts = series.value_counts().dropna().head(8)

    top_values = [
        ValueCount(
            value=str(value),
            count=int(count),
        )
        for value, count in value_counts.items()
    ]

    unique_count = int(series.dropna().nunique())

    return CategoricalSummary(
        top_values=top_values,
        cardinality_flag=cardinality_flag(unique_count, len(series)),
    )


def build_date_range(series: pd.Series) -> DateRange:
    values = series.dropna()

    return DateRange(
        min=values.min().to_pydatetime(),
        max=values.max().to_pydatetime(),
    )


def build_column_profile(series: pd.Series) -> ColumnProfile:
    inferred_type = infer_column_type(series)

    missing_count = int(series.isna().sum())
    row_count = len(series)

    missing_pct = (missing_count / row_count) * 100 if row_count else 0.0

    unique_count = int(series.dropna().nunique())

    numeric_stats = None
    categorical_summary = None
    date_range = None

    if inferred_type == "numeric":
        numeric_stats = build_numeric_stats(series)

    elif inferred_type in ("categorical", "boolean"):
        categorical_summary = build_categorical_summary(series)

    elif inferred_type == "datetime":
        date_range = build_date_range(series)

    return ColumnProfile(
        name=series.name,
        original_name=series.name,
        inferred_type=inferred_type,
        missing_count=missing_count,
        missing_pct=missing_pct,
        unique_count=unique_count,
        numeric_stats=numeric_stats,
        categorical_summary=categorical_summary,
        date_range=date_range,
    )


def build_dataset_profile(
    df: pd.DataFrame, dataset_id: str, filename: str
) -> DatasetProfile:

    columns = [build_column_profile(df[column]) for column in df.columns]

    duplicate_row_count = int(df.duplicated().sum())

    warnings = []

    for column in columns:
        if column.missing_count >= 50:
            warnings.append(
                f"Column '{column.name}' has {column.missing_pct:.1f}% missing values."
            )

        if column.inferred_type == "categorical":
            if column.categorical_summary:
                if column.categorical_summary.cardinality_flag == "high":
                    warnings.append(f"Column '{column.name}' has high cardinality.")

    if duplicate_row_count > 0:
        warnings.append(f"Dataset contains {duplicate_row_count} duplicate rows.")

    return DatasetProfile(
        dataset_id=dataset_id,
        filename=filename,
        row_count=len(df),
        column_count=len(df.columns),
        columns=columns,
        duplicate_row_count=duplicate_row_count,
        warnings=warnings,
        generated_at=datetime.now(timezone.utc),
    )
