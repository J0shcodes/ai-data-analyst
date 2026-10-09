import z from "zod";

export const InsightSchema = z
  .object({
    title: z
      .string()
      .describe(
        "Short headline for this insight, under ~8 words (e.g. 'Highest Revenue Market'). State the finding, not the topic.",
      ),
    description: z
      .string()
      .describe(
        "One to two sentences explaining the finding in plain language. Every number mentioned must come directly from a tool result — never estimate, recompute, or infer figures from the dataset profile alone. Do not speculate about causes the data cannot show.",
      ),
    importance: z
      .enum(["high", "medium", "low"])
      .describe(
        "How central this insight is to answering the user's question. 'high' = directly answers the question; 'medium' = significant supporting context; 'low' = interesting but secondary. Use 'high' sparingly — at most one or two per result.",
      ),
    supporting_metric: z
      .string()
      .nullable()
      .describe(
        "The exact `label` of an entry in this result's `metrics` array that backs this insight, or null if none applies. Must match a real metric label verbatim; do not invent a reference.",
      ),
  })
  .describe(
    "A single finding drawn from tool results. Insights interpret computed numbers; they never introduce new ones.",
  );

export const MetricsSchema = z
  .object({
    label: z
      .string()
      .describe(
        "Short, human-readable name for this metric (e.g. 'Total Revenue', 'Customers Analyzed'). Must be unique within the result, since insights reference metrics by label.",
      ),
    value: z
      .union([z.number(), z.string()])
      .describe(
        "The metric's value, copied from a tool result. Prefer a raw number (e.g. 284320.5) and put the unit in `unit`; do not pre-format with currency symbols, commas, or '%'. Use a string only for non-numeric values (e.g. a category name like 'Nigeria'). Rounding for readability is fine; recalculating is not.",
      ),
    unit: z
      .string()
      .nullable()
      .describe(
        "Unit for `value`, e.g. 'USD', '%', 'customers', 'days'. Null for plain unitless counts or non-numeric values. Only state a unit the data actually supports — if the dataset doesn't say what currency a revenue column is in, don't assume one.",
      ),
    context: z
      .string()
      .nullable()
      .describe(
        "Optional short qualifier that helps interpret the value (e.g. 'across all 10 countries', 'excluding 12 rows with missing revenue'). Null if none is needed. Keep under ~12 words; do not use this field for explanation, which belongs in an insight.",
      ),
  })
  .describe(
    "One computed number surfaced to the user. Every metric must trace back to a specific tool result from this turn — never to your own arithmetic or to the dataset profile.",
  );

export const SeriesConfigSchema = z
  .object({
    key: z
      .string()
      .describe(
        "The property name in each `data` row that holds this series' values. Must exactly match a key present in every row of `data`.",
      ),
    label: z
      .string()
      .describe(
        "Human-readable series name shown in the legend and tooltips (e.g. 'Total Revenue').",
      ),
  })
  .describe("One plotted data series.");

export const FormattingConfigSchema = z
  .object({
    value_format: z
      .enum(["number", "currency", "percent"])
      .describe(
        "How the chart displays y-axis/series values. 'currency' only if the values are monetary; 'percent' only if values are already percentages on a 0–100 scale (not 0–1 fractions); otherwise 'number'.",
      ),
  })
  .describe("Display formatting hints for the chart's values.");

export const AxisConfigSchema = z
  .object({
    key: z
      .string()
      .describe(
        "The property name in each `data` row that holds this axis' values (e.g. 'country' for the x-axis). Must exactly match a key present in every row of `data`.",
      ),
    label: z
      .string()
      .describe(
        "Human-readable axis title, including units where relevant (e.g. 'Country', 'Revenue (USD)').",
      ),
  })
  .describe("Definition of a chart axis.");

export const VisualizationSchema = z
  .object({
    type: z
      .enum(["bar", "line", "area", "pie", "scatter"])
      .describe(
        "Chart type — choose the one that fits the question. 'bar': compare categories (e.g. revenue by country). 'line': change over time or ordered values. 'area': like line, when cumulative volume matters. 'pie': parts of a whole, only for ≤ 6 categories that sum to a meaningful total. 'scatter': relationship between two numeric columns. Never use a type outside this list.",
      ),
    title: z
      .string()
      .describe(
        "Chart title that states what is plotted, e.g. 'Total Revenue by Country'. Under ~10 words.",
      ),
    x_axis: AxisConfigSchema.describe(
      "Horizontal axis. For bar/line/area: the category or time field. For scatter: the first numeric column. For pie: the category (slice name) field.",
    ),
    y_axis: AxisConfigSchema.describe(
      "Vertical axis. For bar/line/area/scatter: the measured value; its `key` should match one of the `series` keys. For pie: the slice value field.",
    ),
    series: z
      .array(SeriesConfigSchema)
      .describe(
        "The data series to plot. Use one series for most charts; use several only to compare multiple measures over the same x values. Every series `key` must exist in every `data` row.",
      ),
    data: z
      .array(z.record(z.string(), z.union([z.number(), z.string()])))
      .describe(
        "The plotted rows, one object per x-axis point (or pie slice / scatter point). Each row must contain the `x_axis.key` and every series `key`, with numbers as numbers (not formatted strings). Values must come straight from tool results — do not invent, estimate, or fill in rows. Keep to ~25 rows or fewer; if a tool result is larger, plot the top entries and say so in the summary.",
      ),
    formatting: FormattingConfigSchema.nullable().describe(
      "Value formatting hints, or null for plain numbers.",
    ),
  })
  .describe(
    "A chart configuration rendered by a fixed set of frontend chart components. It is data only — it cannot contain code, and the frontend ignores anything outside this schema.",
  );

export const MetadataSchema = z
  .object({
    tools_used: z
      .array(z.string())
      .describe(
        "Names of the analysis tools actually called this turn to produce the numbers in this result (e.g. ['group_and_aggregate']). Empty array if no tool was called. List only tools you really called.",
      ),
    dataset_id: z
      .string()
      .describe(
        "The dataset_id the analysis ran against, copied exactly from the dataset profile.",
      ),
    confidence_note: z
      .string()
      .nullable()
      .describe(
        "A short caveat that materially affects how far the result can be trusted, or null if none applies. Use it for things like a small sample ('based on 12 rows'), high missingness in a used column, or a tool result truncated to top-N. Do not use it for generic hedging.",
      ),
  })
  .describe("Provenance and trust information about this analysis.");

export const AnalysisResultSchema = z
  .object({
    summary: z
      .string()
      .describe(
        "A direct, plain-language answer to the user's question in 1–3 sentences, leading with the answer itself. Every figure must come from a tool result. If the question cannot be answered from this dataset (e.g. it references a column that doesn't exist), say so here plainly and leave insights, metrics and visualization empty — do not guess or substitute a similar column.",
      ),
    insights: z
      .array(InsightSchema)
      .describe(
        "0–5 findings that support or add context to the answer, most important first. Empty if the question was unanswerable or a single number fully answers it. Don't pad.",
      ),
    metrics: z
      .array(MetricsSchema)
      .describe(
        "0–8 key computed numbers worth highlighting as stat cards. Only include numbers that appear in tool results this turn. Empty if there are none.",
      ),
    visualization: VisualizationSchema.nullable().describe(
      "Zero or one chart. Include one when a chart makes the answer clearer (comparisons, trends, distributions, relationships). Return an empty array when no chart helps — e.g. a single-number answer, an unanswerable question, or a failed tool call. Never add a chart just for decoration.",
    ),
    metadata: MetadataSchema,
  })
  .describe(
    "The complete, structured answer to the user's question about their dataset. Interpret and explain tool results; never compute, estimate, or invent numbers yourself.",
  );

export type Insight = z.infer<typeof InsightSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type FormattingConfig = z.infer<typeof FormattingConfigSchema>;
export type AxisConfig = z.infer<typeof AxisConfigSchema>;
export type Visualization = z.infer<typeof VisualizationSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
