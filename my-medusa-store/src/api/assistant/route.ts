import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";

type McpTool = {
  name: string;
  description?: string;
  input_schema?: any;
};

function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text.match(fence);
  return m ? m[1] : text;
}

// Normalize LLM tool args to match Medusa Admin expectations
function normalizeToolArgs(input: any): any {
  const needsDollar = new Set([
    "gt","gte","lt","lte","eq","ne","in","nin","not",
    "like","ilike","re","fulltext","overlap","contains","contained","exists",
    "and","or"
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
 * The AI's "brain". It plans the next step based on the user's goal and the history of previous actions.
 * @param userPrompt The original goal from the user.
 * @param tools The list of available tools.
 * @param history The log of tools that have already been called and their results.
 * @returns A plan of action: either call another tool or provide the final answer.
 */
async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: any; tool_result: any }[],
  modelName = "gemini-2.5-flash"
): Promise<{ action: 'call_tool' | 'final_answer'; tool_name?: string; tool_args?: any; answer?: string }> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");

  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  const instruction =
  `You are a reasoning agent for an e-commerce backend. Your goal is to accomplish the user's request by calling tools in sequence. ` +
    `Based on the user's prompt and the history of previous tool calls, decide the next step. ` +
    `You have two possible actions: 'call_tool' or 'final_answer'.\n\n` +
    `1. If you need more information or need to perform an action, choose 'call_tool'.\n` +
    `2. If you have successfully completed the user's request, choose 'final_answer' and provide a summary.\n\n` +
  `If the user asks for a chart/graph/visualization, the final answer MUST include a JSON object (ChartSpec) wrapped in a fenced code block. Use this exact shape:\n` +
  `\n\n\`\`\`json\n` +
  `${JSON.stringify({ type: "chart", chart: "bar", title: "string", xKey: "string", yKey: "string", data: [{ key: "value", value: 0 }] }, null, 2)}\n` +
  `\`\`\`\n\n` +
  `Notes: chart is either "bar" or "line". xKey is the x-axis field name in each data row. yKey is the numeric y-axis field name.\n` +
  `Example: For daily counts, use chart="bar", xKey="date", yKey="count", data=[{"date":"2025-09-01","count":12}, ...].\n` +
  `When a chart is requested, you MUST retrieve real data by calling the most relevant tool based on the user's goal (e.g. Admin* list endpoints).\n` +
  `If the time range is implied (e.g. last 7 days/this week/this month), apply appropriate date filters (created_at/paid_at/etc.), aggregate by day (YYYY-MM-DD), and zero-fill missing days.\n` +
  `Only after you have aggregated data, respond with action=final_answer and include one fenced ChartSpec JSON block in the 'answer'.\n\n` +
  `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON format for calling a tool:\n` +
    `{"action": "call_tool", "tool_name": "string", "tool_args": object}\n\n` +
    `JSON format for providing the final answer:\n` +
    `{"action": "final_answer", "answer": "string"}`;

  const ai = new GoogleGenAI({ apiKey });

  const promptText = [
    instruction,
    `Tool Catalog (JSON):\n${JSON.stringify(toolCatalog, null, 2)}`,
    `History of previous steps (this will be empty on the first turn):\n${JSON.stringify(history, null, 2)}`,
    `User's ultimate goal: ${userPrompt}`,
    `Respond with ONLY the JSON object for the next action.`,
  ].join("\n\n");
  
  const result = await ai.models.generateContent({ model: modelName, contents: promptText });
  const text = result.text;
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
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as { prompt?: string };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const mcp = await getMcp();
    const tools = await mcp.listTools();
    const availableTools: McpTool[] = (tools.tools ?? []) as any;

    // The "memory" of our agent, storing the results of each step
    const history: { tool_name: string; tool_args: any; tool_result: any }[] = [];
    const maxSteps = 5; // A safety limit to prevent infinite loops

    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);
      
      // 1. Ask the AI to plan the next step based on the full history
      const plan = await planNextStepWithGemini(prompt, availableTools, history);

      // 2. Decide what to do based on the AI's planned action
      if (plan.action === "final_answer") {
        console.log("✅ AI decided to provide the final answer.");
        return res.json({ answer: plan.answer, history });
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
        console.log(`   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`);
        
        // 4. Update the history with the outcome of the action
        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: result,
        });
        
        // The loop will now continue to the next step with this new information
      } else {
        throw new Error("AI returned an invalid plan. Cannot proceed.");
      }
    }

    // If the loop finishes, it means the task was too complex or got stuck
    //await mcp.close();
    return res.status(500).json({ 
        error: "The agent could not complete the request within the maximum number of steps.",
        history 
    });

  } catch (e: any) {
    console.error("\n--- 💥 UNCAUGHT EXCEPTION ---");
    console.error(e);
    console.error("--------------------------\n");
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}