import z from "zod";

export const ValueCountSchema = z.object({
  value: z
    .string()
    .describe("One of the most frequent distinct values found in this column."),
  count: z
    .number()
    .int()
    .describe("Number of rows in the dataset containing this exact value."),
});

export const NumericStatsSchema = z
  .object({
    min: z.number().describe("The smallest value present in this column."),
    max: z.number().describe("The largest value present in this column."),
    mean: z
      .number()
      .describe(
        "The arithmetic average of this column. Sensitive to outliers — check `std` before treating this as representative of a 'typical' row.",
      ),
    median: z
      .number()
      .describe(
        "The middle value of this column when sorted. More robust to outliers than `mean`; prefer this when describing a 'typical' value.",
      ),
    std: z
      .number()
      .describe(
        "Standard deviation of this column. A value near 0 means the column is nearly constant; a large value relative to the mean suggests high variance or outliers.",
      ),
  })
  .describe(
    "Summary statistics for a numeric column, computed over all non-missing values. Use these to answer questions about a column's range or typical value without calling a tool — but any aggregation, grouping, or comparison still requires a tool call.",
  );

export const CategoricalSummarySchema = z
  .object({
    top_values: z
      .array(ValueCountSchema)
      .max(8)
      .describe(
        "The most frequent values in this column, ordered by count descending, capped at 8 entries. This is NOT the full list of unique values — do not assume a value is absent from the dataset just because it doesn't appear here. Use `unique_count` to know the true number of distinct values.",
      ),
    cardinality_flag: z
      .enum(["low", "medium", "high"])
      .describe(
        "A hint about how many distinct values this column has relative to the dataset size. 'low' or 'medium' suggest a genuine category suitable for grouping (e.g. status, plan, country). 'high' suggests the column is likely a near-unique identifier (e.g. an ID, email, or name) rather than a meaningful category — grouping or aggregating by it is usually not a useful analysis, even though it's technically possible.",
      ),
  })
  .describe("Summary of a categorical or boolean column's value distribution.");

export const DateRangeSchema = z.object({
  min: z.date().describe("The earliest date present in this column."),
  max: z
    .date()
    .describe(
      "The span of dates covered by a datetime column. Use this to sanity-check whether a requested date range or time period is actually covered by the data before running a time-series analysis.",
    ),
});

export const ColumnProfileSchema = z.object({
  name: z
    .string()
    .describe(
      "The normalized column name. Always use this exact value — not `original_name` — when referencing this column in a tool call argument.",
    ),
  original_name: z
    .string()
    .describe(
      "The column's original name as it appeared in the uploaded file, before normalization. For display/reference only — never use this in tool call arguments.",
    ),
  inferred_type: z
    .enum(["numeric", "categorical", "datetime", "boolean", "text"])
    .describe(
      "How this column's data was classified. This determines which tools and operations are valid: only 'numerical' columns can be aggregated with sum/mean/etc. or correlated; only 'datetime' columns can be used for time-series analysis; only 'categorical' or 'boolean' columns are meaningful to group by or filter with equality checks.",
    ),
  missing_count: z
    .number()
    .int()
    .describe(
      "Number of rows where this column has no value. If this is large relative to the dataset's total row count, treat any aggregation over this column as based on a partial sample and consider noting that caveat in your answer.",
    ),
  missing_pct: z.number(),
  unique_count: z.number().int(),
  numeric_stats: NumericStatsSchema.nullable(),
  categorical_summary: CategoricalSummarySchema.nullable(),
  date_range: DateRangeSchema.nullable(),
});

export const DatasetProfileSchema = z.object({
  dataset_id: z.string(),
  filename: z.string(),
  row_count: z.number().int(),
  column_count: z.number().int(),
  columns: z.array(ColumnProfileSchema),
  duplicate_row_count: z.number().int(),
  warnings: z.array(z.string()),
  generated_at: z.date(),
});

export const DatasetPreviewSchema = z.object({
  dataset_id: z.string(),
  columns: z.array(z.string()),
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
    .max(10),
});

export type ValueCount = z.infer<typeof ValueCountSchema>;
export type NumericStats = z.infer<typeof NumericStatsSchema>;
export type CategoricalSummary = z.infer<typeof CategoricalSummarySchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
export type ColumnProfile = z.infer<typeof ColumnProfileSchema>;
export type DatasetProfile = z.infer<typeof DatasetProfileSchema>;
export type DatasetPreview = z.infer<typeof DatasetPreviewSchema>;
