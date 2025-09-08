import { z } from "zod";
import type { MetricsSummary } from "../types";

/** Zod schemas mirror your types.ts, with safe defaults where the API may omit fields */
const ToolStats = z.object({
  total: z.number(),
  errors: z.number(),
  avgLatency: z.number(),
});

const ToolEvent = z.object({
  id: z.string(),
  timestamp: z.number(),
  tool: z.string(),
  // API may omit args -> optional
  args: z.any().optional(),
  result: z.any().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

const Anomaly = z.object({
  id: z.string(),
  timestamp: z.number(),
  type: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

const NumberDelta = z.object({
  ai: z.number(),
  tool: z.number(),
  diff: z.number(),
  withinTolerance: z.boolean(),
});

const ValidationCheck = z.object({
  label: z.string(),
  ai: z.number().optional(),
  tool: z.number().optional(),
  tolerance: z.number().optional(),
  delta: NumberDelta.optional(),
  ok: z.boolean(),
});

const AssistantTurn = z.object({
  id: z.string(),
  timestamp: z.number(),
  // Make sure userMessage exists even if backend omits it
  userMessage: z.any().optional().default(null),
  assistantMessage: z.any().optional(),
  toolsUsed: z.array(z.string()),
  extractedNumbers: z.record(z.number()).optional(),
  groundedNumbers: z.record(z.number()).optional(),
  validations: z.array(ValidationCheck),
});

const AssistantSummary = z.object({
  turns: z.array(AssistantTurn),
  validation: z.object({
    total: z.number(),
    ok: z.number(),
    fail: z.number(),
  }),
});

const MetricsSummarySchema = z.object({
  totals: z.object({
    totalEvents: z.number(),
    lastHour: z.number(),
  }),
  byTool: z.record(ToolStats),
  rates: z.object({
    thisMinute: z.record(z.number()),
    baselineAvgPerMinute: z.record(z.number()),
  }),
  recentEvents: z.array(ToolEvent),
  anomalies: z.array(Anomaly),
  assistant: AssistantSummary.optional(),
});

/** Fetch + validate */
export async function fetchMetrics(): Promise<MetricsSummary> {
  const res = await fetch("/internal/metrics?format=json", { credentials: "include" });
  const json = await res.json().catch(() => ({} as unknown));

  if (!res.ok) {
    const msg = (json as any)?.error ? String((json as any).error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const parsed = MetricsSummarySchema.safeParse(json);
  if (!parsed.success) {
    // console.error(parsed.error.format());
    throw new Error("Invalid metrics response");
  }

  // Zod ensured presence of userMessage (defaulted to null), and allowed optional args on events.
  return parsed.data as MetricsSummary;
}
