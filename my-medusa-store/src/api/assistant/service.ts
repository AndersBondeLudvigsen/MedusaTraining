import { McpTool, ChartType } from "./types";
import { env, stripJsonFences } from "./utils";
import { getCombinedPrompt } from "./prompts";

export async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: any; tool_result: any }[],
  modelName: string = "gemini-2.5-flash",
  wantsChart: boolean = false,
  chartType: ChartType = "bar"
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
    ? `The user wants a chart visualization. When providing your final answer:
- Call tools that return arrays of data with numeric values (e.g., order counts, revenue amounts, product quantities)
- Prefer data grouped by time periods (dates, months, years) or categories for meaningful charts
- The system will automatically convert your data response into a ${chartType} chart
- Focus on retrieving data that can be visualized effectively in chart format`
    : "Do NOT include any chart/graph JSON. Provide concise text only. If data is needed, call the right tool.";

  // Get the combined prompt for all specializations
  const Prompt = getCombinedPrompt(wantsChart);

  // STATIC CONTENT (sent once as system message)
  const systemMessage =
    `${Prompt}\n\n` +
    `Decide the next step based on the user's goal and the tool-call history.\n` +
    `Actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need information or must perform an action, choose 'call_tool'.\n` +
    `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n` +
    `${chartDirective}\n\n` +
    `CRITICAL API RULES:\n` +
    `- Always check tool schema carefully before making calls\n` +
    `- If a tool call fails, analyze the error and adjust your approach\n` +
    `ERROR RECOVERY STRATEGIES:\n` +
    `- If product search by exact title fails, try partial keyword search\n` +
    `- If variant creation fails with "options" error, ensure options is an object not array\n` +
    `- If variant creation fails with "prices" error, include prices array in every variant\n` +
    `- If JSON parsing fails, ensure your response is valid JSON without extra text\n\n` +
    `Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools).\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON to call a tool: {"action":"call_tool","tool_name":"string","tool_args":object}\n` +
    `JSON for the final answer: {"action":"final_answer","answer":"string"}\n\n` +
    `AVAILABLE TOOLS:\n${JSON.stringify(toolCatalog, null, 2)}`;

  // DYNAMIC CONTENT (changes each loop)
  const userMessage = [
    `User's goal: ${userPrompt}`,
    history.length > 0
      ? `Previous actions taken:\n${JSON.stringify(history, null, 2)}`
      : "No previous actions taken.",
    `What should I do next? Respond with ONLY the JSON object.`,
  ].join("\n\n");

  const ai = new (GoogleGenAI as any)({ apiKey });

  const result = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: "user",
        parts: [{ text: systemMessage }],
      },
      {
        role: "model",
        parts: [
          {
            text: "I understand. I'm ready to help with your e-commerce platform. I'll analyze your request and decide whether to call a tool or provide a final answer. Please provide the current situation.",
          },
        ],
      },
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ],
  });

  const text = (result as any).text;
  if (!text) throw new Error("LLM returned empty response");
  try {
    return JSON.parse(stripJsonFences(text).trim());
  } catch (parseError) {
    console.error("Failed to parse LLM response as JSON:");
    console.error("Raw response:", text);
    console.error("Cleaned response:", stripJsonFences(text).trim());
    console.error("Parse error:", parseError);
    throw new Error(
      `Failed to parse LLM JSON response for the next action. Raw response: ${text.substring(
        0,
        200
      )}...`
    );
  }
}
