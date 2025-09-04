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

// Try hard to parse JSON from a string that might contain extra text or code fences
function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();

  // Find the first '{' and last '}' to be resilient to wrappers
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
  // Common MCP result shape seen in your logs:
  // { content: [ { type: "text", text: "{...json...}" } ], isError?: boolean }
  try {
    const textItem = toolResult?.content?.find?.((c: any) => c?.type === "text");
    if (textItem?.text) {
      const parsed = safeParseJSON(textItem.text);
      if (parsed) return parsed;
    }
  } catch { /* ignore */ }
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
      // fields: ["a","b"] -> "a,b"
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
    // Special-case common numeric query params
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset") {
      return toNumberIfNumericString(val);
    }
    return val;
  };

  return walk(input);
}

/**
 * Build a ChartSpec from known tool-result shapes.
 * Currently supports: getMonthlyOrderReport (scope: "year" | "month" with monthly array)
 */
function buildChartFromLatestTool(
  history: HistoryEntry[],
  opts: { chartType: ChartType; title?: string } = { chartType: "bar" }
): ChartSpec | undefined {
  if (!history.length) return undefined;

  // Find the last *successful* tool result that contains a JSON payload we recognize
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const payload = extractToolJsonPayload(entry.tool_result);
    if (!payload) continue;

    // Case 1: getMonthlyOrderReport year result
    // { scope: "year", year, total, monthly: [{ month: 1..12, count, from, to }, ...] }
    if (
      payload?.scope === "year" &&
      Array.isArray(payload?.monthly) &&
      payload?.monthly.every((m: any) => typeof m?.month === "number" && typeof m?.count === "number")
    ) {
      const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const data = payload.monthly.map((m: any) => ({
        month: monthsShort[(m.month - 1 + 12) % 12],
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

    // Case 2: getMonthlyOrderReport month-only result
    // { scope: "month", year, month, count, ... }
    if (payload?.scope === "month" && typeof payload?.count === "number" && typeof payload?.month === "number") {
      const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const label = `${monthsShort[(payload.month - 1 + 12) % 12]} ${payload.year}`;
      return {
        type: "chart",
        chart: opts.chartType ?? "bar",
        title: opts.title ?? `Orders in ${label}`,
        xKey: "label",
        yKey: "count",
        data: [{ label, count: payload.count }],
      };
    }

    // You can extend here to support compareMonthlyYoY / getYoYDrops, etc.
  }

  return undefined;
}

/**
 * The AI's "brain". It plans the next step based on the user's goal and the history of previous actions.
 * IMPORTANT: We no longer force the model to output chart JSON. We pass a `wantsChart` hint,
 * but charts are rendered server-side from tool results.
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
    ? "The user interface will render any charts. Do NOT produce chart JSON yourself—just obtain the correct data via tools, then summarize the results succinctly."
    : "Do NOT include any chart/graph JSON. Provide a concise textual result only. If data is needed, call the right tool.";

  const instruction =
    `You are a reasoning agent for an e-commerce backend. Your goal is to accomplish the user's request by calling tools in sequence.\n` +
    `You have two possible actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need more information or need to perform an action, choose 'call_tool'.\n` +
    `2) If you have successfully completed the user's request, choose 'final_answer' and provide a concise summary.\n\n` +
    `${chartDirective}\n\n` +
    `Always retrieve real data by calling the most relevant tool(s) based on the user's goal (e.g., Admin* list endpoints or custom report tools like getMonthlyOrderReport).\n` +
    `If the user asks for monthly counts for a given year, prefer calling getMonthlyOrderReport with {"year": YYYY}.\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON for calling a tool:\n` +
    `{"action": "call_tool", "tool_name": "string", "tool_args": object}\n\n` +
    `JSON for providing the final answer:\n` +
    `{"action": "final_answer", "answer": "string"}`;

  const ai = new (GoogleGenAI as any)({ apiKey });

  const promptText = [
    instruction,
    `Tool Catalog (JSON):\n${JSON.stringify(toolCatalog, null, 2)}`,
    `History of previous steps (this will be empty on the first turn):\n${JSON.stringify(history, null, 2)}`,
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
 * This is the main API endpoint. It uses an agent loop to handle multi-step tasks.
 * New: supports { wantsChart?: boolean, chartType?: "bar"|"line", chartTitle?: string } in POST body.
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

    // The "memory" of our agent, storing the results of each step
    const history: HistoryEntry[] = [];
    const maxSteps = 5;

    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);

      // 1. Ask the AI to plan the next step based on the full history
      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        "gemini-2.5-flash",
        wantsChart
      );

      // 2. Decide what to do based on the AI's planned action
      if (plan.action === "final_answer") {
        console.log("✅ AI decided to provide the final answer.");

        // Optionally synthesize a chart from the most recent tool result
        let chart: ChartSpec | undefined = undefined;
        if (wantsChart) {
          chart = buildChartFromLatestTool(history, {
            chartType,
            title: chartTitle,
          });
        }

        // Return both the model's textual answer and (optionally) our chart + raw latest data
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

        // 3. Execute the chosen tool
        const normalizedArgs = normalizeToolArgs(plan.tool_args);
        if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
          console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
        }
        const result = await mcp.callTool(plan.tool_name, normalizedArgs);
        console.log(
          `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
        );

        // 4. Update the history with the outcome of the action
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
