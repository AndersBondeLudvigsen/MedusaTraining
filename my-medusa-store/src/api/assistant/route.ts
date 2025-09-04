import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";

/* ---------------- Types ---------------- */

type McpTool = {
  name: string;
  description?: string;
  input_schema?: any;
};

type HistoryEntry = {
  tool_name: string;
  tool_args: any;
  tool_result: any;
};

type ChartType = "bar" | "line";

type ChartSpec = {
  type: "chart";
  chart: ChartType;
  title: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, string | number>>;
};

/* ---------------- Utils ---------------- */

function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence);
  return m ? m[1] : text;
}

function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return undefined;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

// MCP result: { content: [{ type:"text", text: "...json..." }], isError? }
function extractToolJsonPayload(toolResult: any): any | undefined {
  try {
    const textItem = toolResult?.content?.find?.((c: any) => c?.type === "text");
    if (textItem?.text) return safeParseJSON(textItem.text);
  } catch {}
  return undefined;
}

// Normalize LLM tool args to match Medusa Admin expectations
function normalizeToolArgs(input: any): any {
  const needsDollar = new Set([
    "gt","gte","lt","lte","eq","ne","in","nin","not","like","ilike","re","fulltext",
    "overlap","contains","contained","exists","and","or",
  ]);

  const toNumberIfNumericString = (v: unknown) =>
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;

  const walk = (val: any, keyPath: string[] = []): any => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") return val.map(String).join(",");
      return val.map((v) => walk(v, keyPath));
    }
    if (val && typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const bare = k.replace(/^\$/g, "");
        const newKey = needsDollar.has(bare) ? `$${bare}` : k;
        out[newKey] = walk(v, [...keyPath, newKey]);
      }
      return out;
    }
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset") return toNumberIfNumericString(val);
    return val;
  };

  return walk(input);
}

/* ---------------- Chart building (generic-first, tiny registry for specials) ---------------- */

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const X_PRIORITIES = ["month","label","date","day","bucket","name","email","id"];
const Y_PRIORITIES = ["count","total","amount","revenue","value","quantity","orders","customers","items","sum","avg","median","min","max"];

const isObj = (v: any): v is Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v);

// Depth-first: first array of objects we can chart
function findArrayOfObjects(node: any, depth = 0): any[] | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(node) && node.length && isObj(node[0])) return node;
  if (!isObj(node)) return undefined;
  for (const v of Object.values(node)) {
    const found = findArrayOfObjects(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function monthify(key: string, v: any): any {
  if (key === "month" && typeof v === "number" && v >= 1 && v <= 12) {
    return MONTHS_SHORT[(v - 1 + 12) % 12];
  }
  return v;
}

function pickXY(row: Record<string, any>) {
  let xKey = X_PRIORITIES.find((k) => k in row && (typeof row[k] === "string" || typeof row[k] === "number"));
  let yKey = Y_PRIORITIES.find((k) => k in row && typeof row[k] === "number");
  if (!xKey) xKey = Object.keys(row).find((k) => typeof row[k] === "string" || typeof row[k] === "number");
  if (!yKey) yKey = Object.keys(row).find((k) => typeof row[k] === "number" && k !== xKey);
  return { xKey, yKey };
}

/** If a tool already returns a chart spec, honor it. */
function coerceChartSpec(payload: any): ChartSpec | undefined {
  if (payload?.type === "chart" && Array.isArray(payload?.data)) {
    const s = payload as ChartSpec;
    if (s.chart === "bar" || s.chart === "line") return s;
  }
  return undefined;
}

/** If a tool returns a generic series, use it. Supports:
 *  - { series:[{ x, y }], xKey?: "...", yKey?: "...", title?: "..." }
 *  - { series:[{ label, count }] } (xKey defaults to "label", yKey to "count")
 */
function chartFromSeries(payload: any, chartType: ChartType, title?: string): ChartSpec | undefined {
  const series = Array.isArray(payload?.series) ? payload.series : undefined;
  if (!series || !series.length || !isObj(series[0])) return undefined;

  const sample = series[0] as Record<string, any>;
  const xKey = typeof payload?.xKey === "string"
    ? payload.xKey
    : ("label" in sample ? "label" : "x" in sample ? "x" : undefined);
  const yKey = typeof payload?.yKey === "string"
    ? payload.yKey
    : ("count" in sample ? "count" : "y" in sample ? "y" : undefined);
  if (!xKey || !yKey) return undefined;

  const rows = series.slice(0, 100).map((r: any) => ({
    [xKey]: monthify(xKey, r[xKey]),
    [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
  }));

  return {
    type: "chart",
    chart: chartType,
    title: payload?.title || title || "Results",
    xKey,
    yKey,
    data: rows,
  };
}

/** Generic fallback: root count OR any array of objects. */
function genericChartFromPayload(payload: any, chartType: ChartType, title?: string): ChartSpec | undefined {
  if (typeof payload?.count === "number") {
    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Total",
      xKey: "label",
      yKey: "count",
      data: [{ label: "Total", count: payload.count }],
    };
  }

  const arr = findArrayOfObjects(payload);
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0] as Record<string, any>;
    const { xKey, yKey } = pickXY(first);
    if (!xKey || !yKey) return undefined;

    const rows = arr.slice(0, 24).map((r) => ({
      [xKey]: monthify(xKey, r[xKey]),
      [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
    }));

    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Results",
      xKey,
      yKey,
      data: rows,
    };
  }

  return undefined;
}

/** Tiny registry for the very few shapes that benefit from a nicer chart than the generic one. */
type Mapper = (payload: any, chartType: ChartType, title?: string) => ChartSpec | undefined;
const SHAPE_MAPPERS: Record<string, Mapper> = {
  // compareMonthlyYoY: provide 2 bars (prev vs current) instead of generic nothing
  month_yoy: (payload, chartType, title) => {
    if (
      typeof payload?.month === "number" &&
      typeof payload?.a?.year === "number" && typeof payload?.a?.count === "number" &&
      typeof payload?.b?.year === "number" && typeof payload?.b?.count === "number"
    ) {
      const monthName = MONTHS_SHORT[(payload.month - 1 + 12) % 12];
      const data = [
        { label: String(payload.b.year), count: payload.b.count },
        { label: String(payload.a.year), count: payload.a.count },
      ];
      return {
        type: "chart",
        chart: chartType,
        title: title ?? `${monthName} YoY (${payload.b.year} vs ${payload.a.year})`,
        xKey: "label",
        yKey: "count",
        data,
      };
    }
    return undefined;
  },
  // getYoYDrops: chart deltas by month
  yoy_drops: (payload, chartType, title) => {
    if (!Array.isArray(payload?.details)) return undefined;
    const rows = payload.details
      .filter((d: any) => typeof d?.month === "number" && typeof d?.delta === "number")
      .map((d: any) => ({ month: MONTHS_SHORT[(d.month - 1 + 12) % 12], delta: d.delta as number }));
    return {
      type: "chart",
      chart: chartType,
      title: title ?? `YoY Δ by Month (${payload.previousYear}→${payload.yearCurrent})`,
      xKey: "month",
      yKey: "delta",
      data: rows,
    };
  },
};

/** Build chart from the most recent tool payload:
 *  1) honor payload.chart if present
 *  2) use payload.series if present
 *  3) apply a small shape-specific mapper if scope matches
 *  4) generic fallback (root count / array of objects)
 */
function buildChartFromLatestTool(
  history: HistoryEntry[],
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (!history.length) return undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const payload = extractToolJsonPayload(history[i]?.tool_result);
    if (!payload) continue;

    const explicit = coerceChartSpec(payload);
    if (explicit) return explicit;

    const fromSeries = chartFromSeries(payload, chartType, title);
    if (fromSeries) return fromSeries;

    const mapper = typeof payload?.scope === "string" ? SHAPE_MAPPERS[payload.scope] : undefined;
    if (mapper) {
      const mapped = mapper(payload, chartType, title);
      if (mapped) return mapped;
    }

    const generic = genericChartFromPayload(payload, chartType, title);
    if (generic) return generic;
  }
  return undefined;
}

/* ---------------- Planner ---------------- */

async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: any; tool_result: any }[],
  modelName = "gemini-2.5-flash",
  wantsChart: boolean = false
): Promise<{
  action: "call_tool" | "final_answer";
  tool_name?: string;
  tool_args?: any;
  answer?: string;
}> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");

  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  const chartDirective = wantsChart
    ? "The UI will render charts. Do NOT produce chart JSON—call tools to fetch accurate data and summarize."
    : "Do NOT include any chart/graph JSON. Provide concise text only. If data is needed, call the right tool.";

  const instruction =
    `You are a reasoning agent for an e-commerce backend. Decide the next step based on the user's goal and the tool-call history.\n` +
    `Actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need information or must perform an action, choose 'call_tool'.\n` +
    `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n` +
    `${chartDirective}\n\n` +
    `Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools like getMonthlyOrderReport / compareMonthlyYoY / getYoYDrops).\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON to call a tool: {"action":"call_tool","tool_name":"string","tool_args":object}\n` +
    `JSON for the final answer: {"action":"final_answer","answer":"string"}`;

  const ai = new (GoogleGenAI as any)({ apiKey });

  const promptText = [
    instruction,
    `Tool Catalog (JSON):\n${JSON.stringify(toolCatalog, null, 2)}`,
    `History of previous steps:\n${JSON.stringify(history, null, 2)}`,
    `User's ultimate goal: ${userPrompt}`,
    `Respond with ONLY the JSON object for the next action.`,
  ].join("\n\n");

  const result = await ai.models.generateContent({
    model: modelName,
    contents: promptText,
  });

  const text = (result as any).text;
  if (!text) throw new Error("LLM returned empty response");
  try {
    return JSON.parse(stripJsonFences(text).trim());
  } catch {
    throw new Error("Failed to parse LLM JSON response for the next action");
  }
}

/* ---------------- HTTP handler ---------------- */

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as {
      prompt?: string;
      wantsChart?: boolean;
      chartType?: ChartType;
      chartTitle?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const wantsChart = Boolean(body.wantsChart);
    const chartType: ChartType = body.chartType === "line" ? "line" : "bar";
    const chartTitle = typeof body.chartTitle === "string" ? body.chartTitle : undefined;

    const mcp = await getMcp();
    const tools = await mcp.listTools();
    const availableTools: McpTool[] = (tools.tools ?? []) as any;

    const history: HistoryEntry[] = [];
    const maxSteps = 5;

    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);

      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        "gemini-2.5-flash",
        wantsChart
      );

      if (plan.action === "final_answer") {
        console.log("✅ AI decided to provide the final answer.");

        const latestPayload = extractToolJsonPayload(history[history.length - 1]?.tool_result);
        const chart = wantsChart
          ? buildChartFromLatestTool(history, chartType, chartTitle) ?? null
          : null;

        return res.json({
          answer: plan.answer,
          chart,
          data: latestPayload ?? null,
          history,
        });
      }

      if (plan.action === "call_tool" && plan.tool_name && plan.tool_args) {
        console.log(`🧠 AI wants to call tool: ${plan.tool_name}`);
        console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

        const normalizedArgs = normalizeToolArgs(plan.tool_args);
        if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
          console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
        }
        const result = await mcp.callTool(plan.tool_name, normalizedArgs);
        console.log(`   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`);

        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: result,
        });
      } else {
        throw new Error("AI returned an invalid plan. Cannot proceed.");
      }
    }

    return res.status(500).json({
      error: "The agent could not complete the request within the maximum number of steps.",
      history,
    });
  } catch (e: any) {
    console.error("\n--- 💥 UNCAUGHT EXCEPTION ---");
    console.error(e);
    console.error("--------------------------\n");
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
