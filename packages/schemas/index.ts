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

export const ColumnProfileSchema = z
  .object({
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
    missing_pct: z
      .number()
      .describe(
        "`missing_count` expressed as a percentage of the dataset's total row count.",
      ),
    unique_count: z
      .number()
      .int()
      .describe(
        "The total number of distinct non-missing values in this column. This is the authoritative measure of cardinality — use it instead of counting entries in `top_values`, which is capped at 8.",
      ),
    numeric_stats: NumericStatsSchema.nullable().describe(
      "Present only when `inferred_type` is 'numerical'; null for every other type.",
    ),
    categorical_summary: CategoricalSummarySchema.nullable().describe(
      "Present only when `inferred_type` is 'categorical' or 'boolean'; null for every other type.",
    ),
    date_range: DateRangeSchema.nullable().describe(
      "Present only when `inferred_type` is 'datetime'; null for every other type.",
    ),
  })
  .describe(
    "A profile of a single column: its type, data-quality signals, and — depending on type — either numeric stats, a categorical value breakdown, or a date range. This is descriptive context only; it does not contain per-row data, so it cannot answer questions requiring computation on its own.",
  );

export const DatasetProfileSchema = z
  .object({
    dataset_id: z
      .string()
      .describe(
        "The unique identifier for this dataset. Include this exact value in every tool call that operates on the dataset.",
      ),
    filename: z
      .string()
      .describe(
        "The original filename as uploaded by the user. For display/reference only.",
      ),
    row_count: z
      .number()
      .int()
      .describe(
        "Total number of rows in the dataset, including rows with missing values in some columns.",
      ),
    column_count: z
      .number()
      .int()
      .describe("Total number of columns in the dataset."),
    columns: z
      .array(ColumnProfileSchema)
      .describe(
        "A profile for every column in the dataset. When a question references a column, match it against each entry's `name` (or `original_name` if the user's wording is closer to that) before assuming the column exists — if no column matches, say so rather than guessing or substituting a similar-sounding column.",
      ),
    duplicate_row_count: z
      .number()
      .int()
      .describe(
        "Number of rows that are exact duplicates of another row across every column. Duplicates are reported but not removed automatically — do not assume they've been filtered out of any statistic in this profile or in a tool result.",
      ),
    warnings: z
      .array(z.string())
      .describe(
        "Human-readable data-quality caveats about this dataset (e.g. high missingness in a column, an encoding fallback). Consider these when interpreting results and mention a relevant one in your answer if it materially affects confidence in that answer.",
      ),
    generated_at: z
      .date()
      .describe(
        "When this profile was computed. Not typically relevant to answering questions, but indicates the profile's freshness if the dataset could have changed.",
      ),
  })
  .describe(
    "A structural and statistical summary of an uploaded dataset. This is the ONLY context you have about the dataset's contents — it contains no raw row-level data. Use it to understand what columns exist and what they look like, and to decide which analysis tool to call; it cannot itself answer questions that require filtering, grouping, aggregating, or computing anything beyond what's already summarized here.",
  );

export const DatasetPreviewSchema = z
  .object({
    dataset_id: z.string().describe("The dataset this preview belongs to."),
    columns: z
      .array(z.string())
      .describe(
        "Normalized column names, in the same order as each row's keys.",
      ),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
      .max(10)
      .describe(
        "A capped sample of up to 10 raw rows, for human display purposes only.",
      ),
  })
  .describe(
    "A small, human-facing sample of actual rows. This is rendered in the UI for the user to visually inspect their data — it is never passed to the LLM's context, and must not be included in any prompt or tool result.",
  );

export type ValueCount = z.infer<typeof ValueCountSchema>;
export type NumericStats = z.infer<typeof NumericStatsSchema>;
export type CategoricalSummary = z.infer<typeof CategoricalSummarySchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
export type ColumnProfile = z.infer<typeof ColumnProfileSchema>;
export type DatasetProfile = z.infer<typeof DatasetProfileSchema>;
export type DatasetPreview = z.infer<typeof DatasetPreviewSchema>;
