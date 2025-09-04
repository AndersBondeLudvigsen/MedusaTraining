import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";

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
  const candidate = stripped.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

// Extract a JSON payload (if any) from an MCP tool result
function extractToolJsonPayload(toolResult: any): any | undefined {
  try {
    const textItem = toolResult?.content?.find?.((c: any) => c?.type === "text");
    if (textItem?.text) {
      const parsed = safeParseJSON(textItem.text);
      if (parsed) return parsed;
    }
  } catch {}
  return undefined;
}

// Normalize LLM tool args to match Medusa Admin expectations
function normalizeToolArgs(input: any): any {
  const needsDollar = new Set([
    "gt",
    "gte",
    "lt",
    "lte",
    "eq",
    "ne",
    "in",
    "nin",
    "not",
    "like",
    "ilike",
    "re",
    "fulltext",
    "overlap",
    "contains",
    "contained",
    "exists",
    "and",
    "or",
  ]);

  const toNumberIfNumericString = (v: unknown) => {
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return v;
  };

  const walk = (val: any, keyPath: string[] = []): any => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") {
        return val.map(String).join(",");
      }
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
    if (last === "limit" || last === "offset") {
      return toNumberIfNumericString(val);
    }
    return val;
  };

  return walk(input);
}

// ---------- Generic chart helpers ----------

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const X_PRIORITIES = ["month","label","date","day","bucket","name","email","id"];
const Y_PRIORITIES = ["count","total","amount","revenue","value","quantity","orders","customers","items","sum","avg","median","min","max"];

function isPlainObject(v: any): v is Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Depth-first search for first array of objects
function findArrayOfObjects(node: any, depth = 0): any[] | undefined {
  if (depth > 4) return undefined; // keep it cheap
  if (Array.isArray(node) && node.length && isPlainObject(node[0])) return node;
  if (!isPlainObject(node)) return undefined;
  for (const v of Object.values(node)) {
    const found = findArrayOfObjects(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function monthLabelMaybe(key: string, value: any): string | number {
  if (key === "month" && typeof value === "number" && value >= 1 && value <= 12) {
    return MONTHS_SHORT[(value - 1 + 12) % 12];
  }
  return value as any;
}

function pickKeysFromRow(row: Record<string, any>) {
  // prefer priorities; otherwise first string-like for X and first numeric for Y
  let xKey = X_PRIORITIES.find((k) => k in row && (typeof row[k] === "string" || typeof row[k] === "number"));
  let yKey = Y_PRIORITIES.find((k) => k in row && typeof row[k] === "number");

  if (!xKey) {
    xKey = Object.keys(row).find((k) => typeof row[k] === "string" || typeof row[k] === "number");
  }
  if (!yKey) {
    yKey = Object.keys(row).find((k) => typeof row[k] === "number" && k !== xKey);
  }
  return { xKey, yKey };
}

function buildGenericChartFromPayload(
  payload: any,
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  // Case A: root count -> single bar
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

  // Case B: any array of objects
  const arr = findArrayOfObjects(payload);
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0] as Record<string, any>;
    const { xKey, yKey } = pickKeysFromRow(first);
    if (!xKey || !yKey) return undefined;

    // small cap to keep the chart readable
    const rows = arr.slice(0, 24).map((r) => ({
      [xKey]: monthLabelMaybe(xKey, r[xKey]),
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

/**
 * Build a ChartSpec from known tool-result shapes, with a GENERIC fallback.
 * Supports:
 *  - getMonthlyOrderReport (scope: "year" | "month")
 *  - compareMonthlyYoY (scope: "month_yoy")
 *  - getYoYDrops (scope: "yoy_drops")
 *  - Generic fallback: root {count} or any array of objects
 */
function buildChartFromLatestTool(
  history: HistoryEntry[],
  opts: { chartType: ChartType; title?: string } = { chartType: "bar" }
): ChartSpec | undefined {
  if (!history.length) return undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const payload = extractToolJsonPayload(entry.tool_result);
    if (!payload) continue;

    // ---- Specific: getMonthlyOrderReport (year) ----
    if (
      payload?.scope === "year" &&
      Array.isArray(payload?.monthly) &&
      payload.monthly.every((m: any) => typeof m?.month === "number" && typeof m?.count === "number")
    ) {
      const data = payload.monthly.map((m: any) => ({
        month: MONTHS_SHORT[(m.month - 1 + 12) % 12],
        count: m.count,
      }));
      return {
        type: "chart",
        chart: opts.chartType ?? "bar",
        title: opts.title ?? `Monthly Orders (${payload.year})`,
        xKey: "month",
        yKey: "count",
        data,
      };
    }

    // ---- Specific: getMonthlyOrderReport (month) ----
    if (payload?.scope === "month" && typeof payload?.count === "number" && typeof payload?.month === "number") {
      const label = `${MONTHS_SHORT[(payload.month - 1 + 12) % 12]} ${payload.year}`;
      return {
        type: "chart",
        chart: opts.chartType ?? "bar",
        title: opts.title ?? `Orders in ${label}`,
        xKey: "label",
        yKey: "count",
        data: [{ label, count: payload.count }],
      };
    }

    // ---- Specific: compareMonthlyYoY ----
    if (
      payload?.scope === "month_yoy" &&
      typeof payload?.month === "number" &&
      payload?.a && payload?.b &&
      typeof payload?.a?.year === "number" &&
      typeof payload?.b?.year === "number" &&
      typeof payload?.a?.count === "number" &&
      typeof payload?.b?.count === "number"
    ) {
      const monthName = MONTHS_SHORT[(payload.month - 1 + 12) % 12];
      const data = [
        { label: String(payload.b.year), count: payload.b.count },
        { label: String(payload.a.year), count: payload.a.count },
      ];
      return {
        type: "chart",
        chart: opts.chartType ?? "bar",
        title: opts.title ?? `${monthName} YoY (${payload.b.year} vs ${payload.a.year})`,
        xKey: "label",
        yKey: "count",
        data,
      };
    }

    // ---- Specific: getYoYDrops ----
    if (
      payload?.scope === "yoy_drops" &&
      typeof payload?.yearCurrent === "number" &&
      Array.isArray(payload?.details)
    ) {
      const rows = payload.details
        .filter((d: any) => typeof d?.month === "number" && typeof d?.delta === "number")
        .map((d: any) => ({
          month: MONTHS_SHORT[(d.month - 1 + 12) % 12],
          delta: d.delta as number,
        }));
      const title =
        opts.title ?? `YoY Δ by Month (${payload.previousYear}→${payload.yearCurrent})`;
      return {
        type: "chart",
        chart: opts.chartType ?? "bar",
        title,
        xKey: "month",
        yKey: "delta",
        data: rows,
      };
    }

    // ---- Generic fallback ----
    const generic = buildGenericChartFromPayload(payload, opts.chartType ?? "bar", opts.title);
    if (generic) return generic;
  }

  return undefined;
}

/**
 * The AI's "brain". We don't ask the model to emit chart JSON.
 * Charts are built server-side from tool results.
 */
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
    ? "The UI will render charts. Do NOT produce chart JSON—call tools to get accurate data and summarize."
    : "Do NOT include any chart/graph JSON. Provide a concise textual result only. If data is needed, call the right tool.";

  const instruction =
    `You are a reasoning agent for an e-commerce backend. Decide the next step based on the user's goal and tool-call history.\n` +
    `Actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need information or must perform an action, choose 'call_tool'.\n` +
    `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n` +
    `${chartDirective}\n\n` +
    `Always retrieve real data via the most relevant tool (e.g., Admin* list endpoints or custom tools like getMonthlyOrderReport / compareMonthlyYoY / getYoYDrops).\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON for calling a tool:\n{"action":"call_tool","tool_name":"string","tool_args":object}\n\n` +
    `JSON for final answer:\n{"action":"final_answer","answer":"string"}`;

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
    const parsed = JSON.parse(stripJsonFences(text).trim());
    return parsed;
  } catch {
    throw new Error("Failed to parse LLM JSON response for the next action");
  }
}

/**
 * Main API endpoint.
 * Supports { wantsChart?: boolean, chartType?: "bar"|"line", chartTitle?: string } in POST body.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as {
      prompt?: string;
      wantsChart?: boolean;
      chartType?: ChartType;
      chartTitle?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

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

        let chart: ChartSpec | undefined = undefined;
        if (wantsChart) {
          chart = buildChartFromLatestTool(history, {
            chartType,
            title: chartTitle,
          });
        }

        const latestPayload = extractToolJsonPayload(history[history.length - 1]?.tool_result);
        return res.json({
          answer: plan.answer,
          chart: chart ?? null,
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
        console.log(
          `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
        );

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
      error:
        "The agent could not complete the request within the maximum number of steps.",
      history,
    });
  } catch (e: any) {
    console.error("\n--- 💥 UNCAUGHT EXCEPTION ---");
    console.error(e);
    console.error("--------------------------\n");
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
