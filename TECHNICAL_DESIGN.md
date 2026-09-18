# AI Data Analyst — Technical Design / Architecture Document

Status: Draft v1.0
Companion to: PRD.md, README.md

---

## 1. Architecture Overview

AI Data Analyst is a **pnpm/Turborepo monorepo** with two runtime
applications and one shared contracts package:

- **`apps/web`** — Next.js (App Router). Owns the UI, the LLM orchestration
  (via the Vercel AI SDK), and the tool-calling loop. Talks to `apps/api`
  over plain HTTP/JSON for all data operations.
- **`apps/api`** — FastAPI. Owns dataset ingestion, profiling, and every
  deterministic analysis operation (Pandas). Has **no knowledge of the LLM
  provider, prompts, or conversation state.** It is a pure compute service.
- **`packages/schemas`** — TypeScript types (Zod schemas) that mirror the
  Pydantic models in `apps/api`, hand-kept in sync (see §7, "Contract
  Strategy") and used by both the Next.js orchestration layer and the UI.

The system's one non-negotiable invariant: **any number the user sees was
produced by a named, schema-validated Pandas function, not by the model.**
Every other decision in this document is downstream of protecting that
invariant while keeping the codebase small enough for one developer.

```
                 ┌──────────────────────────┐
                 │        apps/web          │
                 │  (Next.js, App Router)   │
                 │                          │
                 │  Browser (React + AI SDK │
                 │  UI hooks: useChat)      │
                 │            │             │
                 │            ▼             │
                 │  /api/chat route.ts      │
                 │  (Vercel AI SDK:         │
                 │   streamText + tools)    │
                 └───────────┬──────────────┘
                             │ HTTP/JSON
                             │ (upload, profile, tool calls)
                             ▼
                 ┌──────────────────────────┐
                 │         apps/api         │
                 │        (FastAPI)         │
                 │  Dataset store (in-mem)  │
                 │  Pandas analysis tools   │
                 │  Pydantic contracts      │
                 └──────────────────────────┘
```

## 2. Architecture Decision Record — AI SDK ↔ FastAPI Boundary

This is the central decision of the project (PRD §"critical architecture
decision"). It is documented here in full ADR form because every other
component depends on it.

### Options Considered

**Option A — Next.js owns everything AI; FastAPI is pure data.**
Next.js route handlers use the Vercel AI SDK directly (`streamText`,
`tool()`), and every tool's `execute()` calls a thin FastAPI compute
endpoint over HTTP. FastAPI never sees the LLM, a prompt, or an API key.

**Option B — FastAPI owns the entire AI orchestration.**
FastAPI holds the LLM client, the tool-calling loop, and produces
streaming output (SSE) that Next.js relays to the browser. Next.js is a
near-static client.

**Option C — Next.js provides a thin AI-facing adapter; FastAPI owns data
and/or orchestration** (a spectrum between A and B, e.g. Next.js does
prompt assembly but FastAPI runs the tool loop, or vice versa, with a
custom protocol between them).

### Comparison

| Criterion | Option A | Option B | Option C (hybrid) |
|---|---|---|---|
| Vercel AI SDK integration | Native — SDK is a JS/TS library; used exactly as designed | Not usable — SDK has no Python runtime; you'd hand-roll the same primitives in Python | Partial — SDK still confined to JS side, so it collapses to A wherever it's actually used |
| Streaming to browser | Native `useChat`/`useObject` consume the SDK's own stream protocol with zero glue | Requires either reimplementing the AI SDK's UI-message stream protocol in Python, or bypassing SDK UI hooks and hand-rolling `fetch` + `ReadableStream` parsing in React | Same problem as B for whichever side does the streaming |
| Tool calling | Native `tool()` + multi-step loop (`stopWhen`/`maxSteps`) built into the SDK | Must hand-write the OpenAI/Anthropic tool-calling loop in Python (not hard, but duplicates what the SDK already does well) | Splits the loop across a network boundary — the hardest of the three to keep correct |
| Structured outputs | Native `generateObject`/`streamObject` with Zod schemas | Must validate LLM structured output with Pydantic manually (fine, but a second schema implementation to keep in sync) | Two schema implementations *and* a cross-boundary handoff mid-generation |
| Type safety | Zod schemas live where they're consumed (Next.js); FastAPI's Pydantic models only describe compute I/O, which is inherently simple (DataFrame-shaped) | Pydantic must model the *entire* AI contract (tool calls, structured output, streaming events) in addition to compute I/O | Worst of both — both sides need near-complete schemas |
| Latency | One extra HTTP hop per tool call (LLM ⇄ Next.js ⇄ FastAPI ⇄ Pandas); each hop is local/low-latency | LLM ⇄ FastAPI is one hop, but a second hop still exists (FastAPI ⇄ Next.js ⇄ browser) for the SSE relay | Comparable to A, plus coordination overhead |
| Complexity for a solo dev | Lowest — one AI orchestration implementation, one language for it | Medium-high — reimplements SDK internals in Python | Highest — a bespoke protocol to design, document, and debug |
| Separation of concerns | Very clean: FastAPI = compute, Next.js = product/AI orchestration | Clean in principle, but the "product" layer (Next.js) becomes a dumb relay, which undersells its role in a *Next.js* learning project | Blurred — orchestration logic split unpredictably |
| Local dev experience | Two processes (`next dev`, `uvicorn`), FastAPI trivially mockable/curl-able independent of the LLM | Same two processes, but testing AI behavior requires FastAPI running with a live/mocked provider | Same two processes, but debugging requires reasoning about both at once |
| Deployment | `apps/web` needs the LLM API key; `apps/api` needs nothing but compute resources — deploy independently, scale independently | `apps/api` needs the LLM API key and must be always-on for chat; `apps/web` is nearly stateless | Deployment topology unclear until the protocol is fixed |
| Learning value for *this* project | High — you get real, idiomatic reps with the AI SDK's actual intended usage, which is one of the project's explicit goals | Low for the AI SDK goal (you'd barely touch it); high for "build an LLM loop from scratch," which is not a stated goal | Diffuse — you partially learn several things instead of deeply learning the one thing the project set out to teach |

### Decision

**Option A**, with one refinement: FastAPI's compute endpoints are called
directly from inside each AI SDK `tool()`'s `execute()` function, as plain
`fetch()` calls returning JSON. No SSE, no custom protocol, no shared
streaming transport is invented between Next.js and FastAPI — that
boundary is ordinary request/response REST. The **only** place a
streaming protocol exists is between the Next.js route and the browser,
and it is exactly the Vercel AI SDK's own UI-message stream protocol,
consumed by `useChat`. This satisfies the brief's instruction not to
invent an AI SDK/FastAPI integration mechanism: there isn't one, because
FastAPI is never inside the AI SDK's streaming path at all.

### Why

- The Vercel AI SDK's value (tool calling, structured output, multi-step
  loops, streaming UI hooks) is realized in full, with zero adaptation
  layer, because it runs where it's designed to run: a Next.js route.
- FastAPI is left free to be an excellent, idiomatic Pandas/Pydantic
  service, which is equally a stated learning goal — it isn't diminished
  by this choice, it's *purified*: no AI concerns leak into it.
- The two apps can be developed, tested, and reasoned about independently.
  You can `curl` every FastAPI endpoint and get a deterministic answer
  with no LLM involved, which makes debugging tool bugs trivial.
- Tool-call latency (an extra local HTTP hop) is negligible compared to
  LLM inference latency, so Option A's only real cost is invisible at MVP
  scale.

### Tradeoffs Accepted

- FastAPI's own async/streaming capabilities (SSE) go unused in the MVP.
  This is a deliberate, stated tradeoff (see §11, Streaming Design) — they
  remain available for a specific future case (very large dataset
  profiling) without changing today's architecture.
- The LLM's context about the dataset is limited to whatever the profile
  and tool results describe; FastAPI cannot "reach into" the conversation.
  This is a feature, not a bug — it enforces the profile-not-raw-data
  boundary in PRD §11.
- Next.js now holds the LLM API key and all prompting/tool logic, making
  it the heavier of the two apps. This matches the project's framing:
  Next.js is the *product*, FastAPI is a *service* it depends on.

## 3. System Components and Responsibilities

| Component | Responsibility | Does NOT do |
|---|---|---|
| `apps/web` — UI layer | Upload UX, question input, streaming render, chart rendering | Any Pandas computation, any raw-data handling |
| `apps/web` — `/api/chat` route | Prompt assembly, AI SDK `streamText` call, tool registry, multi-step loop, structured output validation, streaming to browser | Actual data computation (delegates to `apps/api` via tool `execute()`) |
| `apps/web` — `/api/datasets` route | Thin proxy/adapter for upload and profile fetch, if any web-side pre/post-processing is needed (e.g. re-shaping error messages) | Persisting datasets itself |
| `apps/api` — Ingestion | CSV validation, parsing, column normalization, type inference, dataset storage, profile generation | Talking to any LLM |
| `apps/api` — Analysis tools | Deterministic Pandas operations behind a fixed registry of tool endpoints | Interpreting results in natural language |
| `packages/schemas` | Canonical Zod definitions for `DatasetProfile`, `AnalysisResult`, tool I/O, consumed by `apps/web` | Runtime logic |

## 4. Data Flow (End-to-End)

```
1. CSV Upload
   Browser --(multipart/form-data)--> Next.js /api/datasets (proxy)
   Next.js --(multipart passthrough)--> FastAPI POST /datasets
   FastAPI: validate → parse → normalize → infer types → profile → store
   FastAPI --(DatasetProfile JSON)--> Next.js --> Browser
   Browser renders DatasetOverview; stores dataset_id in client state.

2. User Question
   Browser --(dataset_id, question, prior messages)--> Next.js /api/chat
   Next.js: assemble system prompt + DatasetProfile + conversation
            call streamText() with tool registry bound to dataset_id

3. Tool Selection & Execution (0..N bounded steps)
   LLM --(tool_call: name, args)--> AI SDK
   AI SDK --(execute(args))--> tool implementation in Next.js
   tool implementation --(HTTP POST, validated args)--> FastAPI
        /datasets/{dataset_id}/tools/{tool_name}
   FastAPI: validate args against tool input schema
            run Pandas operation
            return ToolResult JSON (or structured error)
   tool implementation --(ToolResult)--> AI SDK --> LLM (as tool output)

4. Interpretation & Structured Output
   LLM produces final structured object matching AnalysisResult schema
   (via streamObject/experimental structured final step — see §9)

5. Streaming Transport
   Next.js route returns the AI SDK's UI-message stream
   (status/tool-call/tool-result/text/object deltas) as the HTTP response

6. Frontend Consumption
   useChat/useObject on the browser consumes the stream incrementally
   React renders: StreamingStatus → AnalysisMessage (summary) →
   InsightCard[] → MetricCard[] → ChartRenderer
```

### What Crosses Each Boundary

| Boundary | Payload | Shape |
|---|---|---|
| Browser → Next.js (upload) | Raw file (multipart) | `multipart/form-data`, one `file` field |
| Next.js → FastAPI (upload) | Raw file (multipart, passthrough) | same |
| FastAPI → Next.js (profile) | `DatasetProfile` | JSON, Pydantic model |
| Next.js → FastAPI (health) | none | GET |
| Browser → Next.js (question) | `dataset_id`, `messages[]` (AI SDK message format) | JSON |
| Next.js (tool execute) → FastAPI | tool-specific args + `dataset_id` | JSON, one schema per tool |
| FastAPI → Next.js (tool result) | `ToolResult` (success) or `ToolError` | JSON |
| Next.js (AI SDK) → Browser | UI message stream: text deltas, tool-call events, tool-result events, final structured object, error events | AI SDK's native stream protocol (SSE-like, over `fetch` `ReadableStream`) |

No payload larger than the dataset profile and a handful of aggregated rows
ever crosses the LLM boundary; the raw DataFrame never leaves `apps/api`.

## 5. Dataset Lifecycle

**Decision: keep the DataFrame in an in-process, in-memory store keyed by
`dataset_id`, with a TTL-based eviction sweep. No database.**

### Why

- MVP datasets are small (CSV, capped size — see §12 Security). Holding
  one DataFrame per active session in memory is trivial and fast.
- A database would add a persistence model, migrations, and a second
  source of truth for something that is explicitly ephemeral by product
  requirement (PRD F12). That's complexity with no corresponding
  requirement.
- Disk storage (e.g., writing the CSV to a temp path and re-reading per
  request) avoids memory pressure but adds I/O latency and file lifecycle
  management for no benefit at this scale; deferred to Future Scope if
  dataset sizes grow.

### Mechanism

- `apps/api` holds a process-global `dict[str, DatasetEntry]` where
  `DatasetEntry = { df: pd.DataFrame, profile: DatasetProfile, created_at,
  last_accessed_at }`.
- A background task (FastAPI `lifespan` + `asyncio` periodic task) evicts
  entries whose `last_accessed_at` exceeds a configurable TTL (default: 30
  minutes).
- `dataset_id` is a server-generated UUID4, returned to the client on
  upload and required on every subsequent profile/tool/chat call.
- **Explicit limitation, stated plainly:** this design does not survive a
  server restart and does not scale beyond a single FastAPI process. Both
  are acceptable for a local learning project and are called out in the
  README's "Known Limitations."
- **Multiple concurrent datasets are already supported, at no extra
  design cost.** Because the store is a dict keyed by `dataset_id` rather
  than a single global slot, nothing prevents several datasets from being
  uploaded and held in memory at once, each with its own TTL clock. This
  was implicit in the original design and is made explicit here because
  the frontend's Datasets page needs to list more than one dataset: it
  does **not** require a database, a schema change, or joins between
  datasets — it only requires a way to enumerate the store's current keys
  (§12, `GET /datasets`). "No database" and "list the datasets currently
  in memory" are not in tension.

### Ingestion Rules

| Concern | Rule |
|---|---|
| Allowed file types | `.csv` only (checked by extension **and** sniffed content, not extension alone) |
| Size limit | Configurable, default 10 MB (see §12) |
| Encoding | Attempt UTF-8; fall back to `latin-1` with a profile warning if UTF-8 decoding fails; reject if neither parses |
| Malformed CSV | Caught via `pandas.errors.ParserError`; returns a 422 with a specific message (e.g., inconsistent column counts) |
| Empty file | Rejected at 0 rows or 0 columns with a distinct error from "malformed" |
| Column-name normalization | Trim whitespace, collapse internal whitespace to `_`, lowercase, de-duplicate collisions with a numeric suffix; original names retained in the profile as `original_name` |
| Missing values | Detected per-column (`NaN`/empty string/whitespace-only treated as missing); counted, not dropped |
| Type inference | Pandas dtype inference first; then a heuristic pass to reclassify into `numeric \| categorical \| datetime \| boolean \| text`; a column is `datetime` if ≥90% of non-null values parse via `pd.to_datetime` with a bounded format guess list |
| Duplicate rows | Counted and reported in the profile; **not** dropped automatically (dropping is a decision the user/LLM can request via a future tool, not an ingestion-time side effect) |
| Dataset identifiers | UUID4 `dataset_id`, generated server-side, never derived from filename or content |

## 6. Dataset Profile Schema

The profile is the **only** dataset-shaped context the LLM ever receives.
It must be information-dense but bounded — no per-row data, no full
value lists for high-cardinality columns.

```text
DatasetProfile
├── dataset_id: str
├── filename: str
├── row_count: int
├── column_count: int
├── columns: ColumnProfile[]
├── duplicate_row_count: int
├── warnings: str[]              # e.g. "3 columns had >50% missing values"
└── generated_at: datetime

ColumnProfile
├── name: str                    # normalized name (used by tools)
├── original_name: str
├── inferred_type: "numeric" | "categorical" | "datetime" | "boolean" | "text"
├── missing_count: int
├── missing_pct: float
├── unique_count: int
├── numeric_stats: NumericStats | null      # present iff inferred_type == numeric
├── categorical_summary: CategoricalSummary | null  # present iff categorical/boolean
├── date_range: DateRange | null            # present iff inferred_type == datetime

NumericStats
├── min, max, mean, median, std: float

CategoricalSummary
├── top_values: {value: str, count: int}[]   # capped at 8 entries
├── cardinality_flag: "low" | "medium" | "high"  # high = likely identifier, not categorical

DateRange
├── min: date, max: date
```

**Deliberately omitted from the profile:** any per-row values, full
category enumerations for high-cardinality text columns, and column-level
correlation matrices (available on demand via the `calculate_correlation`
tool instead of being pre-computed for every profile). This keeps the
profile payload small (a few KB even for wide datasets) and keeps the LLM
from being tempted to "eyeball" an answer from summary stats alone —
anything beyond simple description still requires a tool call.

### Dataset Preview (Human-Facing, Separate from the Profile)

The Dataset Detail page needs to show a person the first ~10 rows of
their data. That is a legitimate, human-facing need that is **deliberately
not met by `DatasetProfile`**, which excludes row-level data on purpose
(§6, above) so the LLM's context never contains raw rows. Rather than
weaken the profile to satisfy the UI, this is a second, narrow, explicitly
non-LLM-facing contract:

```text
DatasetPreview
├── dataset_id: str
├── columns: str[]                  # normalized column names, in order
└── rows: Record<str, string|number|null>[]   # capped at 10 rows
```

**Decision:** `DatasetPreview` is returned only by its own endpoint
(`GET /datasets/{dataset_id}/preview`, §12) and is never included in, or
derived into, anything passed to the LLM — not the system prompt, not a
tool result. The dataset-lifecycle rule that matters here is not "no raw
rows ever exist in a response," it's "no raw rows ever reach the model."
A human looking at a 10-row preview in the browser does not compromise
that boundary; an LLM receiving the same 10 rows as context would.

**Why:** keeping this as a separate endpoint (rather than an optional
field bolted onto `DatasetProfile`) means the profile — the one payload
that *does* get assembled into a prompt — never has an accidental path by
which raw values leak into it later (e.g., a future developer naively
serializing "the whole profile" into the system prompt). The two
contracts stay structurally incapable of being confused for one another.

## 7. Contract Strategy (`packages/schemas`)

Pydantic (Python) and Zod (TypeScript) cannot literally share a runtime
type. The pragmatic MVP approach:

- **Pydantic models in `apps/api`** are the source of truth for anything
  FastAPI returns or accepts.
- **Zod schemas in `packages/schemas`** are hand-written mirrors, used by
  `apps/web` to (a) validate FastAPI responses at the boundary and (b)
  define the AI SDK tool `inputSchema`/structured-output schema.
- A contract test (see §14 Testing) fixture-checks that a sample payload
  produced by the real FastAPI endpoint parses successfully against the
  corresponding Zod schema, catching drift without needing full codegen.
- **Explicit assumption stated:** OpenAPI-to-Zod codegen (e.g.
  `openapi-typescript`) is a reasonable future upgrade once the schemas
  stabilize, but is skipped for the MVP to avoid a build-tool dependency
  before the shapes are even settled.

## 8. Analysis Tool Architecture

Tools are the **only** path from a question to a number. Each tool is:
(1) a Pydantic input model, (2) a Pydantic output model, (3) a pure Python
function operating on the stored DataFrame, (4) a FastAPI endpoint, and
(5) a mirrored Zod input schema + AI SDK `tool()` definition in Next.js.

### MVP Tool Set

| Tool | Purpose | Input | Output (summary) | Failure Behavior |
|---|---|---|---|---|
| `get_dataset_profile` | Re-fetch the profile mid-conversation (rarely needed since it's in the system prompt, but allowed for explicit re-grounding) | `{dataset_id}` | `DatasetProfile` | 404 if dataset expired |
| `get_column_statistics` | Detailed stats for one or more named columns beyond the profile summary | `{dataset_id, columns: str[]}` | Per-column `NumericStats`/`CategoricalSummary` | 422 if any column name unknown — lists valid names |
| `filter_rows` | Apply ≤5 simple predicate conditions (`column`, `op`, `value`) and return the resulting row count + a small preview (≤10 rows) | `{dataset_id, conditions: Condition[], limit}` | `{matched_row_count, preview_rows}` | 422 on unknown column/op or type-mismatched value |
| `group_and_aggregate` | Group by 1–2 categorical/datetime columns, aggregate 1–3 numeric columns with a named function (`sum`,`mean`,`count`,`min`,`max`) | `{dataset_id, group_by: str[], aggregations: Agg[], sort_by, limit}` | `{groups: {key, values}[]}` | 422 on invalid group/agg column or unsupported function |
| `calculate_percentage` | Compute a share-of-total (e.g., % of revenue per country) from a prior `group_and_aggregate`-shaped result or a fresh grouping | `{dataset_id, group_by, value_column}` | `{groups: {key, value, pct}[]}` | 422 if value_column not numeric |
| `calculate_correlation` | Pearson correlation between two numeric columns | `{dataset_id, column_a, column_b}` | `{coefficient, n}` | 422 if either column non-numeric or `n < 2` |
| `time_series_summary` | Resample a datetime column at a given frequency and aggregate a numeric column | `{dataset_id, date_column, value_column, freq: "D"\|"W"\|"M", agg}` | `{points: {period, value}[]}` | 422 if date_column not datetime-typed |

**Explicitly excluded from the MVP tool set** (and why): `sort_results` as
a standalone tool (folded into `group_and_aggregate`'s `sort_by`/`limit`
params — a separate tool would just re-sort output already in hand, adding
a round trip with no new capability); a generic `run_query`/`execute_sql`
tool (this is exactly the arbitrary-execution risk the project explicitly
forbids); a `predict`/forecasting tool (out of scope — no modeling
requirement in the PRD).

### Cross-Cutting Tool Rules

- Every tool endpoint validates its Pydantic input model before touching
  the DataFrame; validation failure returns a structured `ToolError` with
  an `error_code` and a human-readable `message`, never a stack trace.
- Every tool result is capped in size (row previews, top-N groups) so a
  pathological query (e.g., grouping by a near-unique-cardinality column)
  can't blow up the LLM context.
- Tools are **stateless** with respect to conversation — each call only
  knows `dataset_id` + its own arguments, never prior tool calls. Any
  "based on the last result" reasoning happens in the LLM, which re-issues
  a fresh, fully-specified tool call.
- The Next.js tool-calling loop is bounded (`stopWhen: stepCountIs(4)` or
  equivalent AI SDK primitive) to prevent runaway multi-tool chains for a
  single question.

### Deterministic-but-not-a-tool logic

Column-name validation against the profile, and simple "does this question
even reference a column in this dataset" pre-checks, are handled directly
in the Next.js orchestration layer before ever calling the LLM with tools
— cheap enough not to need a tool round-trip, and useful for short-circuit
"I don't see that column" responses.

## 9. Structured Output Contract

```text
AnalysisResult
├── summary: string                     # 1–3 sentence plain-language answer
├── insights: Insight[]                 # 0–5 items
├── metrics: Metric[]                   # 0–8 items
├── visualization: Visualization | null # null when no chart is appropriate
└── metadata: Metadata

Insight
├── title: string
├── description: string
├── importance: "high" | "medium" | "low"
└── supporting_metric: string | null    # references a Metric.label, if any

Metric
├── label: string
├── value: number | string
├── unit: string | null                 # e.g. "USD", "%", null for counts
└── context: string | null              # e.g. "vs. previous month" — free text, short

Visualization
├── type: "bar" | "line" | "area" | "pie" | "scatter"
├── title: string
├── x_axis: { key: string, label: string }
├── y_axis: { key: string, label: string }
├── series: { key: string, label: string }[]   # 1..n for multi-series
├── data: Record<string, number | string>[]    # rows keyed by x_axis.key/series keys
└── formatting: { value_format: "number" | "currency" | "percent" } | null

Metadata
├── tools_used: string[]                # names of tools invoked for this answer
├── dataset_id: string
└── confidence_note: string | null      # optional caveat, e.g. "based on 12 rows"
```

**Design notes / deviations from the illustrative example in the brief:**

- `visualization` is nullable — not every question deserves a chart (e.g.
  "how many rows are missing a signup date"); forcing one would encourage
  decorative, meaningless charts.
- `metadata.tools_used` is included specifically so the frontend/dev can
  display or log *which* deterministic computation backs an answer — a
  direct, checkable trace from claim to computation, which matters more
  here than in a generic chat product.
- `data` in `Visualization` is a small, already-shaped array of plain
  records (not raw tool output) so `ChartRenderer` never needs
  chart-library-specific reshaping logic driven by model output — the
  model must emit data already in the renderer's expected shape, validated
  by Zod before render.
- Chart types are a **closed enum**. The model cannot introduce a new type;
  an unrecognized value fails schema validation and is treated as "no
  chart" (§10).

## 10. Chart Rendering Architecture

```
LLM structured chart config (Visualization)
        │
        ▼
Zod schema validation (packages/schemas)
        │  invalid → treated as visualization: null, summary/insights still render
        ▼
Next.js server: pass validated object as props (no eval, no dynamic import
        by model-provided string)
        │
        ▼
<ChartRenderer visualization={...} />
        │
        ▼  switch on visualization.type (closed union, exhaustive)
        ▼
<BarChart/> | <LineChart/> | <AreaChart/> | <PieChart/> | <ScatterChart/>
   (each a fixed React component using Recharts, statically imported)
```

- The mapping from `type` to component is a **static, exhaustive switch
  statement** (TypeScript's exhaustiveness checking on the closed union
  guarantees every enum value is handled at compile time). There is no
  dynamic component lookup by string, no `React.lazy` keyed by model
  output, and no code the model provides is ever executed — only *data*
  the model provides is ever rendered, through fixed components.
- If validation fails or `visualization` is `null`, `ChartRenderer` simply
  isn't mounted; the rest of `AnalysisMessage` renders normally (PRD N2).

## 11. Streaming Design

### What Streams and Why

| Stream content | Direction | Purpose |
|---|---|---|
| Upload progress | Browser ⇄ Next.js | Native `XMLHttpRequest`/`fetch` upload progress event — not a custom protocol, just UI feedback for a multipart POST |
| Status events (`uploading`, `profiling`, `thinking`, `running_tool:{name}`, `interpreting`, `done`, `error`) | Next.js → Browser | User-safe progress narration, driven by AI SDK step/tool-call lifecycle events, not chain-of-thought |
| Text deltas (the `summary` as it's generated) | Next.js → Browser | Native AI SDK `streamText`/`streamObject` token streaming |
| Tool-call / tool-result events | Next.js → Browser | AI SDK emits these natively; surfaced to `StreamingStatus` as "running `group_and_aggregate`…" / "done" |
| Final structured object (`AnalysisResult`) | Next.js → Browser | Delivered via the AI SDK's structured-output streaming (`streamObject`-style partial object deltas), so `InsightCard`s/`MetricCard`s can appear as soon as their array entries are complete rather than waiting for the whole object |
| Errors | Next.js → Browser | AI SDK error events / a typed error part in the stream |

### Explicitly NOT Streamed

- Model chain-of-thought/reasoning tokens (PRD AI Behavior Requirements —
  not requested from the provider, and not forwarded even if present).
- Raw tool results (these are intermediate; only their *interpreted* form
  reaches the user, via the final structured content, except for the
  lightweight "tool X completed" status ping).

### Why FastAPI Does Not Stream in the MVP

FastAPI's operations (profile a small CSV, run one Pandas aggregation) are
computed synchronously in milliseconds to low-hundreds-of-milliseconds at
MVP data sizes. Streaming exists to improve perceived latency on
*slow, incremental* operations — the LLM call is the slow, incremental
part of this system, and it already streams, end to end, via the AI SDK.
Adding SSE from FastAPI would add a second streaming protocol for no
user-visible benefit and is explicitly deferred (PRD Future Scope) to the
day a specific operation (e.g., profiling a multi-hundred-MB file) is
slow enough to need it — at which point `apps/api` would expose that one
endpoint as SSE, decoded in the Next.js proxy route and re-emitted as
ordinary status events on the existing stream, with no change to the
browser-facing protocol.

### Frontend Consumption

- `apps/web` uses `useChat` (or `useObject` for the structured final
  result, per whichever the current AI SDK version recommends — see §16)
  to consume the stream; partial state is held in React state managed by
  the hook itself, not hand-rolled reducers.
- Partial rendering: `AnalysisMessage` renders `summary` as it streams;
  `insights`/`metrics` render item-by-item as the partial object gains
  array entries; `ChartRenderer` mounts only once `visualization` is
  either complete-and-valid or definitively `null`.
- **Tool failure mid-stream:** the failed tool's result is a structured
  `ToolError`, which is returned to the LLM as the tool's output (not
  thrown to the transport layer). The LLM is expected to incorporate the
  failure into its `summary`/produce a no-chart result. If the *transport*
  itself fails (network drop, provider 5xx), the stream ends with an error
  event; the UI keeps whatever partial content already rendered and offers
  a retry action rather than clearing the thread.

## 12. API Design (FastAPI)

| Method | Path | Purpose | Request | Response | Notable status codes |
|---|---|---|---|---|---|
| `POST` | `/datasets` | Upload and profile a CSV | `multipart/form-data`, field `file` | `DatasetProfile` | `201` created; `400` wrong type; `413` too large; `422` malformed/empty CSV |
| `GET` | `/datasets` | List datasets currently held in memory (for the Datasets page / dashboard counts) | — | `{datasets: DatasetSummary[]}` | `200` (empty array if none — never an error) |
| `GET` | `/datasets/{dataset_id}` | Re-fetch a dataset's profile | — | `DatasetProfile` | `200`; `404` unknown/expired |
| `GET` | `/datasets/{dataset_id}/preview` | Fetch a capped, human-facing row preview (§6, "Dataset Preview") | — | `DatasetPreview` | `200`; `404` unknown/expired |
| `POST` | `/datasets/{dataset_id}/tools/{tool_name}` | Execute one analysis tool | Tool-specific Pydantic input model (JSON) | Tool-specific output model, or `ToolError` | `200`; `404` unknown dataset/tool; `422` invalid arguments |
| `DELETE` | `/datasets/{dataset_id}` | Explicit early eviction (used by the frontend on "start over") | — | `204` | `404` unknown |
| `GET` | `/health` | Liveness check | — | `{status: "ok"}` | `200` |

`DatasetSummary` is a lightweight projection of `DatasetProfile` — just
`{dataset_id, filename, row_count, column_count, created_at,
last_accessed_at}` — sized for a list view, not the full column-level
detail (fetch `GET /datasets/{id}` for that once a specific dataset is
selected). `GET /datasets` reads the same in-memory store as every other
endpoint; it does not introduce a new persistence layer, and its results
still disappear on TTL eviction or server restart, consistent with the
lifecycle in §5.

Every request/response body is a Pydantic model; FastAPI's automatic
OpenAPI schema serves as living documentation and as the manual
cross-check source for the mirrored Zod schemas (§7). Tool endpoints are
implemented as one `POST /datasets/{id}/tools/{tool_name}` dispatcher (not
N separate paths) so adding a tool means adding one registry entry, not
one new route — but each tool's request/response is still its own
distinct Pydantic model, dispatched by `tool_name`.

## 13. Frontend Architecture

### Components

| Component | Type | Responsibility |
|---|---|---|
| `DatasetUploader` | Client | File picker/dropzone, upload progress, upload error display |
| `DatasetOverview` | Server (hydrated with client-fetched data) | Renders `DatasetProfile` summary |
| `QuestionInput` | Client | Text input + submit, disabled until a dataset exists |
| `AnalysisThread` | Client | Owns `useChat` state; renders a list of `AnalysisMessage` |
| `AnalysisMessage` | Client | One turn: streaming summary text + child cards |
| `InsightCard` | Client (presentational) | Renders one `Insight` |
| `MetricCard` | Client (presentational) | Renders one `Metric` |
| `ChartRenderer` | Client | Validates + dispatches to a chart component (§10) |
| `StreamingStatus` | Client | Renders the current status event as a short label/progress indicator |
| `ErrorState` | Client (presentational) | Generic inline error box, parameterized by message + retry callback |
| `DatasetsTable` | Client | Lists datasets from `GET /datasets`; search/filter is client-side over the fetched list |
| `DatasetPreviewTable` | Client | Renders `DatasetPreview` rows on the Dataset Detail page |
| `RecentAnalysesList` | Client | Renders locally-stored analysis history (see "Analysis history," below) on the Overview/Analyses pages |

### State

- **Dataset state:** `dataset_id` + `DatasetProfile`, held in a small
  client context/provider at the page level. With multiple datasets now
  listable (§5, §12), this context tracks the *active* dataset; the full
  list is fetched on demand for the Datasets/Overview pages rather than
  held globally — no global state library is needed for this either.
- **Conversation state:** entirely owned by `useChat` from `@ai-sdk/react`;
  no parallel hand-rolled message array.
- **Analysis history (client-only, explicit decision):** the Overview
  page's "Recent Analyses" and any dedicated Analyses page are backed by
  a small `localStorage`-persisted list of `{question, dataset_id,
  dataset_filename, timestamp, status, analysis_id}` entries, appended to
  whenever a turn in `AnalysisThread` completes. This is a **UI
  convenience only** — it is not a new backend requirement, it does not
  touch FastAPI, and it does not change the "no database" decision in
  §5. It is explicitly **not authoritative**: it is scoped to one
  browser, is lost if storage is cleared, and is never treated as a
  substitute for the actual `AnalysisResult` (which either lives in the
  current `useChat` conversation state or is gone — history stores just
  enough metadata to *label* a past question, not to replay its full
  result). If persisted, cross-device analysis history is ever wanted,
  that is a Future Scope backend feature, not a fix to this decision.
- **Loading/streaming state:** derived from `useChat`'s own status
  (`submitted`/`streaming`/`ready`/`error`) plus the custom status events
  parsed out of the stream for tool-level granularity.
- **Error state:** local to the component that can fail (uploader owns
  upload errors; `AnalysisThread` owns analysis errors) — no global error
  boundary swallowing context.

### Server vs. Client Components

- The page shell (layout, static copy) is a Server Component.
- Everything interactive (`DatasetUploader`, `AnalysisThread`,
  `QuestionInput`, and all card components once they need client state or
  the `useChat` hook) is a Client Component.
- `DatasetOverview` can be a Server Component that receives the already-
  fetched profile as a prop from its client parent, since it's purely
  presentational.

### Accessibility & Responsiveness

- Streaming status changes are announced via an `aria-live="polite"`
  region so screen reader users get progress updates without a flood of
  interruptions.
- Charts include a text-equivalent summary (the `summary`/`metrics`
  already provide this in prose) so the chart is a supplement, not the
  sole source of the answer.
- Layout uses a responsive two/one-column breakpoint (overview + chat side
  by side on wide viewports, stacked on narrow ones); no chart/table is
  allowed to force horizontal scroll on a typical laptop width.

## 14. AI SDK Responsibilities (Concrete)

- **Package(s):** the core `ai` package plus the framework binding
  `@ai-sdk/react` in `apps/web`, and a provider package for whichever
  single provider is chosen initially (e.g. `@ai-sdk/openai` or
  `@ai-sdk/anthropic`) — kept isolated behind the abstraction in §15.
- **UI functionality used:** `useChat` for the conversational thread and
  its streaming lifecycle; structured content within the assistant message
  is parsed against the `AnalysisResult` Zod schema before being handed to
  presentational components.
- **Server functionality used:** `streamText` with a `tools` map (each tool
  defined via the SDK's `tool()` helper, `inputSchema` from
  `packages/schemas`, and an `execute()` that calls FastAPI) and a bounded
  step count; the final structured result is produced either via a
  dedicated final "answer" tool call that carries the `AnalysisResult`
  shape, or via `streamObject`/`generateObject` layered after the
  tool-calling phase completes — the exact mechanism must be confirmed
  against current AI SDK docs at implementation time (see caveat below),
  but the architectural requirement is fixed: **tool calling happens
  first and is separate from, and prerequisite to, structured-result
  generation.**
- **Protocol to FastAPI:** plain JSON over HTTP, no AI SDK involvement
  whatsoever on that side — FastAPI is just an HTTP service the tool
  `execute()` functions call.
- **When an SDK helper doesn't fit:** if a future AI SDK version changes
  how structured final answers compose with tool calling, the fallback is
  to have the last step's tool be a schema-validated "finalize" tool whose
  arguments *are* the `AnalysisResult` — guaranteeing a validated
  structured shape regardless of which higher-level helper is or isn't
  available.
- **Explicit caveat (per project brief):** the Vercel AI SDK's API surface
  changes across versions; the exact helper names/signatures above
  (`streamText`, `tool`, `useChat`, `streamObject`, `stopWhen`) must be
  verified against the official documentation for the SDK version pinned
  in `package.json` at implementation time, rather than assumed from this
  document.

## 15. LLM Provider Abstraction

- All tool definitions, schemas, and prompt content are written against
  the AI SDK's **provider-agnostic** `LanguageModel` interface, not
  against any vendor SDK directly.
- A single module, e.g. `apps/web/src/lib/ai/model.ts`, is the only place
  that imports a concrete provider package and constructs the model
  instance from an environment variable (`AI_PROVIDER`, `AI_MODEL`, plus
  the provider's API key). Every route imports the model from this module,
  never from a provider package directly.
- Switching providers means changing this one module and the relevant
  environment variables — no change to tool definitions, prompts, or
  schemas, because those are expressed against the AI SDK's common
  interface.
- MVP ships with one provider selected for simplicity (left as an
  implementation-time choice); the abstraction is what's required, not a
  second working provider.

## 16. Security and Safety

| Concern | Mitigation |
|---|---|
| File validation | Extension check + content sniff (reject if not parseable as CSV); reject non-CSV MIME types at the proxy route before the file reaches FastAPI |
| File-size limits | Enforced at both the Next.js proxy (reject oversized requests early) and FastAPI (defense in depth); default 10 MB, configurable via env |
| Malicious/malformed CSV | Pandas parsing wrapped in explicit exception handling; no `eval`/`exec` anywhere in the ingestion or tool path |
| CSV formula injection | Cell values beginning with `=`, `+`, `-`, `@` are treated as **text**, never interpreted, and are neutralized (prefixed) in any value that might later be exported/opened in spreadsheet software; irrelevant to in-app rendering but included since the CSV could be re-exported |
| Resource exhaustion | Size cap (above) + a hard row/column ceiling checked before full profiling; requests exceeding it are rejected with a clear error rather than attempted |
| Prompt injection from dataset content | The LLM never receives raw cell values beyond the small, capped previews/top-values already present in the profile and tool outputs; the system prompt explicitly instructs the model to treat all data-derived text as data, not instructions, and tool outputs are passed as tool-role content (not concatenated into a user/system message the model might treat as directives) |
| Tool input validation | Every tool call validated against its Pydantic model before touching the DataFrame; unknown columns/operators rejected with a specific message |
| Arbitrary code execution | No tool ever accepts a code string, query string, or expression to `eval`; every tool is a fixed, parameterized operation |
| Secret management | LLM API key lives only in `apps/api`'s... correction: only in `apps/web`'s server-side environment (`.env`, never `.env.local` public vars); never referenced in any Client Component or sent to the browser |
| CORS | FastAPI CORS restricted to the known Next.js origin(s) (`localhost:3000` in dev, the deployed origin in any future deployment) |
| Rate limiting | Not implemented for MVP (no auth, single local user); noted as a requirement *before* any public deployment, not before local learning use |
| Error-message sanitization | FastAPI exception handlers convert internal exceptions to a fixed set of `ToolError`/`UploadError` shapes with safe messages; stack traces never serialize into an HTTP response body (only to server logs) |

## 17. Error Handling

### Frontend
- Upload errors: caught from the proxy route's non-2xx response, mapped
  to a specific message by status code, shown inline in `DatasetUploader`.
- Network errors: `fetch` rejection surfaces a generic "couldn't reach the
  server" `ErrorState` with retry.
- Malformed stream/response: Zod parse failure on the final structured
  object is caught; `summary`/`insights`/`metrics` still render from
  whatever validated successfully, `visualization` falls back to `null`.
- Stream interruption: `useChat`'s error state triggers an inline retry
  affordance in `AnalysisThread`; prior messages are preserved.
- Invalid chart config: handled entirely in `ChartRenderer` (§10) —
  never a thrown exception, always a graceful "no chart" branch.

### FastAPI
- Invalid files / malformed CSV / empty file: distinct `422` error bodies
  with an `error_code` enum (`INVALID_FILE_TYPE`, `EMPTY_FILE`,
  `PARSE_ERROR`, `TOO_LARGE`) so the frontend can map codes to copy
  without string matching.
- Pandas runtime errors inside a tool (e.g., unexpected dtype at compute
  time despite passing input validation): caught, logged with full detail
  server-side, returned to the caller as a generic `TOOL_EXECUTION_ERROR`
  with a safe message.
- Unsupported operation / invalid tool arguments: `422` with the specific
  invalid field named.
- Dataset not found/expired: `404` with `DATASET_NOT_FOUND`, prompting the
  frontend to ask the user to re-upload.
- FastAPI has no LLM-facing failures by design (it doesn't call the LLM).

### LLM (handled in the Next.js orchestration layer)
- Malformed tool call (bad JSON args from the model): AI SDK's schema
  validation on `inputSchema` rejects it before `execute()` runs; the
  model receives a validation error as the tool result and can retry with
  corrected arguments (bounded by the step limit).
- Structured-output schema validation failure: treated as a hard failure
  of that turn — the user sees a generic "couldn't produce a valid answer,
  try rephrasing" message rather than a malformed object reaching the UI.
- Unsupported question / hallucinated column reference: caught by the
  pre-check described in §8 ("deterministic-but-not-a-tool logic") where
  possible, and otherwise by the model itself producing a `summary`-only
  result with `insights`/`metrics` empty and `visualization: null` —
  this is a valid, expected `AnalysisResult`, not an error.
- Inability to answer: same as above — a well-formed "I can't answer this"
  result is a first-class success case, not an exception path.

## 18. Testing Strategy

### Python (`apps/api`)
- Unit tests per analysis tool function, using small fixture DataFrames
  covering: normal case, empty-result case, and each documented failure
  mode (unknown column, wrong dtype).
- Unit tests for dataset profiling: type inference edge cases (a column
  that's 90% numeric strings + 10% text; a column of dates in mixed
  formats), missing-value counting, duplicate detection.
- Pydantic model tests: invalid payloads for every tool input model raise
  the expected validation error.
- API tests (FastAPI `TestClient`) for every endpoint: happy path + each
  documented error status code.
- Edge cases: 1-row CSV, 1-column CSV, all-missing column, all-identical
  values column (std = 0), non-UTF-8 file.

### Next.js (`apps/web`)
- Component tests for `ChartRenderer`: one test per chart type with valid
  data, plus a test asserting `visualization: null` and an invalid-schema
  case both render the "no chart" fallback without throwing.
- Component tests for `DatasetUploader`: file-type rejection, size
  rejection, success path (mocked upload endpoint).
- Stream-handling tests: feed a mocked AI SDK stream (text deltas +
  partial object deltas) into `AnalysisThread` and assert progressive
  rendering order (summary → insights → metrics → chart).
- Error-state tests: simulate a dropped stream and assert partial content
  is retained and a retry control appears.

### Integration
- Full-flow test: upload the sample CSV against a running (or
  test-mode) FastAPI, ask a fixed question, assert a valid
  `AnalysisResult` is produced (with the LLM call mocked to return a
  scripted tool call + structured output, so this test is deterministic
  and doesn't depend on a live model).
- Tool-calling workflow test: assert that a given mocked model tool call
  reaches the correct FastAPI endpoint with correctly-shaped arguments and
  that the tool's response round-trips back into the mocked model context
  unchanged.
- Streaming workflow test: assert the HTTP response from `/api/chat` is a
  valid AI SDK stream (correct content-type/framing) end-to-end with a
  mocked model.

### AI Behavior
- **Deterministic tests** (exact assertions, no live model calls) cover
  everything *except* natural-language generation: tool selection given a
  scripted/mocked model response, schema conformance of any structured
  output, the tool-calling step limit being enforced, and the "profile
  pre-check short-circuits an obviously-invalid column reference" path.
- **Evaluation-style checks** (not exact-match) are used only for actual
  live-model behavior, e.g. "does the model choose `group_and_aggregate`
  over `filter_rows` for a grouping question" — run occasionally/manually
  against a small fixed set of example questions (PRD §Sample Dataset),
  graded by inspection, not asserted as CI-blocking exact-match tests.
  The project explicitly does not claim LLM prose output can be tested
  with string equality.

## 19. Observability (Lightweight)

- Every request into `apps/api` is tagged with a `request_id`
  (middleware-generated if not provided) included in all log lines for
  that request.
- `dataset_id` and, where applicable, `tool_name` are included in
  structured log entries (JSON lines to stdout is sufficient — no log
  aggregation service).
- Tool execution timing is logged per call (`tool_name`, `duration_ms`,
  `success`/`error_code`).
- In `apps/web`, the AI SDK's usage metadata (tokens in/out, per-call
  latency), when exposed by the SDK/provider, is logged per chat request
  alongside an `analysis_id` correlating the full turn.
- No metrics backend, tracing system, or dashboard is introduced — logs
  are read directly (`docker logs`/terminal output) during local
  development, which is sufficient for a single-developer learning
  project.

## 20. Deployment Considerations (Non-Binding, Future)

Not required for the MVP (which targets local development only), but
documented so the architecture doesn't accidentally preclude it:

- `apps/web` deploys naturally to Vercel (it's a standard Next.js app);
  the LLM API key becomes a Vercel environment variable.
- `apps/api` deploys as a standard ASGI service (e.g. a small container on
  Fly.io/Render/Railway); the in-memory dataset store means it must run as
  a **single instance** (no horizontal scaling) unless/until the store is
  moved to Redis or similar — an explicit, stated limitation of the
  current design, not an oversight.
- CORS origins and the FastAPI base URL become environment-specific
  configuration in both apps.

## 21. Future Scalability Considerations

- Swapping the in-memory dataset store for Redis (or similar) would allow
  multiple `apps/api` instances; the `DatasetEntry` shape is already
  serializable (DataFrame → parquet/pickle bytes) which makes this a
  contained change, not a rearchitecture.
- Adding a second LLM provider is a single new module behind the
  abstraction in §15.
- Adding a tool is additive: one Pydantic pair + one Python function + one
  registry entry (FastAPI) + one Zod schema + one `tool()` entry
  (Next.js) — no change to the orchestration loop itself.
- Adding a chart type is additive: one enum value + one component + one
  switch arm — the exhaustiveness check in TypeScript will flag any
  omission at compile time.

## 22. Tradeoffs Summary (Explicit Decisions)

| Decision | Why | Alternatives Considered | Tradeoff Accepted |
|---|---|---|---|
| Option A (Next.js-owns-AI) for the SDK/FastAPI boundary | Uses AI SDK natively; keeps FastAPI pure | Option B (FastAPI owns AI), Option C (hybrid/custom protocol) | FastAPI's async/SSE strengths unused at MVP scale |
| In-memory dataset store, no DB | Matches ephemeral-by-requirement product scope; simplest safe design | SQLite/Postgres persistence, on-disk temp files | No horizontal scale, no restart survival |
| Fixed, closed tool registry | Removes arbitrary-execution risk entirely; keeps LLM's numeric output always traceable | LLM-generated pandas/SQL expressions | Less flexible for novel/ad-hoc analyses not covered by a tool |
| Hand-mirrored Zod/Pydantic schemas, no codegen | Avoids a build-tool dependency before shapes stabilize | OpenAPI codegen, gRPC/protobuf shared contracts | Manual sync discipline required; mitigated by contract tests |
| Nullable `visualization`, closed chart-type enum | Avoids decorative/meaningless charts; guarantees safe rendering | Always-produce-a-chart, LLM-chosen arbitrary chart libraries/components | Fewer visualization options than a fully generic charting model |
| No FastAPI streaming (SSE) in MVP | Only one streaming protocol to build/debug; matches actual latency profile at this data scale | Streaming upload/profiling progress over SSE | Large-file profiling won't show incremental progress until a future change |
| Bounded tool-calling steps | Prevents runaway agent loops on a single question | Unbounded agentic loop | A genuinely multi-hop question could hit the cap and need rephrasing |
| `GET /datasets` list endpoint over the existing in-memory store | Lets the frontend show multiple datasets without adding persistence; the store already keys by `dataset_id` | A database-backed dataset registry; no list endpoint at all (single-dataset-only UI) | The list reflects only what's currently in memory — it's empty after a restart or once TTL evicts everything |
| `DatasetPreview` as its own endpoint, not a field on `DatasetProfile` | Keeps the one LLM-facing contract (`DatasetProfile`) structurally incapable of carrying raw rows into a prompt | An optional `preview_rows` field on `DatasetProfile`, gated by "just don't send that field to the LLM" | One more endpoint/model to define and mirror in Zod |
| Analysis history via client-side `localStorage`, not a backend feature | Satisfies the UI's "Recent Analyses" need with zero backend/database change | A backend `analyses` table/endpoint | History is per-browser, non-authoritative, and lost if storage is cleared or a different device/browser is used |
