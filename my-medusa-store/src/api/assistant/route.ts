import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";

type McpTool = {
  name: string
  description?: string
  input_schema?: any
};

function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text.match(fence);
  return m ? m[1] : text;
}

async function selectToolWithGemini(
  userPrompt: string,
  tools: McpTool[],
  hints?: Record<string, any>,
  modelName = "gemini-1.5-flash"
): Promise<{ name?: string; args?: Record<string, any>; raw?: any }> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const { GoogleGenAI } = await import("@google/genai");

  // Build compact tool schema for the model
  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    // include only the JSON Schema properties for brevity if present
    schema: t.input_schema ?? undefined,
  }));

  const instruction = `You are a tool selector for an e-commerce backend.\n\n` +
    `Choose exactly one tool from the provided catalog that best accomplishes the user's intent. ` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON format:\n` +
    `{"name": string, "args": object}\n\n` +
    `Rules:\n` +
    `- name must be one of the tool names in the catalog.\n` +
    `- args must follow the tool's input JSON schema (field names and types).\n` +
    `- If unsure, pick the most relevant tool and provide minimal sensible args.\n` +
    `- Do not include code fences unless asked (but if you do, it's okay—we'll strip them).`;

  const ai = new GoogleGenAI({ apiKey });
  const promptText = [
    instruction,
    `Tool Catalog (JSON):\n${JSON.stringify(toolCatalog, null, 2)}`,
    `User Prompt: ${userPrompt}`,
    ...(hints && Object.keys(hints).length
      ? [`Hints (preferred args/overrides): ${JSON.stringify(hints)}`]
      : []),
    `Respond with ONLY the JSON object as specified.`,
  ].join("\n\n");

  const result = await ai.models.generateContent({ model: modelName, contents: promptText });
  const text = result.text;
  if (!text) throw new Error("LLM returned empty response");
  let jsonText = stripJsonFences(text).trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (typeof parsed?.name === "string") {
      const name = parsed.name as string;
      const args = (parsed.args ?? {}) as Record<string, any>;
      return { name, args, raw: parsed };
    }
  } catch {
    throw new Error("Failed to parse LLM JSON response");
  }
  throw new Error("LLM did not return a valid tool selection");
}

/**
 * Simple AI-ish assistant endpoint that forwards a natural language prompt
 * to the MCP server by choosing a tool based on a keyword heuristic.
 * In production, replace selection with an LLM that plans tool calls.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
  const body = (req.body ?? {}) as { prompt?: string; tool?: string; args?: Record<string, any> };
    const prompt = body.prompt?.trim();
  const mcp = await getMcp();

    const tools = await mcp.listTools();

    // Tool selection: prefer body.tool or else require LLM to choose — no heuristics.
    let toolName = body.tool;
    let toolArgs = body.args ?? {};
    if (!toolName) {
      if (!prompt) {
        await mcp.close();
        return res.status(400).json({ error: "Missing prompt or explicit tool name" });
      }
      const available: McpTool[] = (tools.tools ?? []) as any;
      const llmChoice = await selectToolWithGemini(prompt, available, toolArgs);
      toolName = llmChoice.name!;
      toolArgs = { ...(llmChoice.args ?? {}), ...(body.args ?? {}) };
    }

    if (!toolName) {
      await mcp.close();
      return res.json({
        message: "No tools available from MCP server.",
        tools: tools.tools ?? [],
      });
    }

    const result = await mcp.callTool(toolName, toolArgs);

    // Make a user-friendly answer if possible
    let answer: string | undefined;
    const textContent = result.content?.find(c => c.type === "text");
    if (textContent && "text" in textContent) {
      answer = textContent.text as string;
    }

    return res.json({
      selectedTool: toolName,
      usedLLM: !body.tool,
      toolArgs,
      result,
      answer: answer ?? "Tool executed successfully.",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
