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
  modelName = "gemini-2.5-flash"
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
    `IMPORTANT RULES:\n` +
    `- name must be one of the tool names in the catalog.\n` +
    `- args must follow the tool's input JSON schema (field names and types).\n` +
    `- AVOID batch operations (tools with "Batch" in name) unless explicitly asked for bulk operations.\n` +
    `- For product creation: ALWAYS include both "title" and "options" in args.\n` +
    `- For customer creation: ALWAYS include "email" in args.\n` +
    `- Do not provide metadata fields unless specifically requested.\n` +
    `- If unsure, pick the most specific non-batch tool and provide all required fields.\n` +
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

async function naturalLanguageAnswerWithGemini(
  userPrompt: string,
  selectedTool: string,
  toolArgs: Record<string, any>,
  toolResult: any,
  modelName = "gemini-2.5-flash"
): Promise<string> {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const { GoogleGenAI } = await import("@google/genai");

  const ai = new GoogleGenAI({ apiKey });
  const summaryPrompt = [
    `You are an assistant that explains structured tool outputs to users in clear, concise natural language.`,
    `User Prompt: ${userPrompt}`,
    `Selected Tool: ${selectedTool}`,
    `Tool Arguments (JSON):\n${JSON.stringify(toolArgs, null, 2)}`,
    `Tool Result (JSON or text):\n${typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2)}`,
    `Instructions:\n- Provide a short, user-friendly answer based on the tool result.\n- Do NOT output JSON or code.\n- Use plain sentences or bullet points.\n- If there are many items, summarize the key points.`,
  ].join("\n\n");

  const response = await ai.models.generateContent({ model: modelName, contents: summaryPrompt });
  const text = response.text ?? "";
  if (!text) throw new Error("LLM returned empty summary");
  return text.trim();
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
      
      // --- 🕵️ LLM TOOL SELECTION ---
      // This block shows you what the AI decided to do based on the prompt.
      console.log("\n\n--- 🕵️ LLM TOOL SELECTION ---");
      console.log("User Prompt:", prompt);
      console.log("LLM Chose Tool:", llmChoice.name);
      console.log("LLM Generated Args:", JSON.stringify(llmChoice.args, null, 2));
      console.log("-----------------------------\n");
      // --- END OF BLOCK ---

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

    // --- 🛠️ MCP TOOL EXECUTION ---
    // This block shows the raw output from the tool call, which contains the real error message.
    console.log("\n--- 🛠️ MCP TOOL EXECUTION ---");
    console.log("Tool Name:", toolName);
    console.log("Final Tool Args:", JSON.stringify(toolArgs, null, 2));
    console.log("RAW TOOL RESULT:", JSON.stringify(result, null, 2)); // This is the most important log.
    console.log("--------------------------\n");

    // Gather tool text output (if present) to aid summarization
    const textParts = Array.isArray(result?.content)
      ? result.content.filter((c: any) => c?.type === "text").map((c: any) => c.text)
      : [];
    const toolText = textParts.length ? textParts.join("\n\n") : undefined;

    // --- 🤖 INPUT TO SUMMARIZER ---
    // This block shows what information the AI is using to generate its final friendly answer.
    const summaryInput = toolText ?? result;
    console.log("\n--- 🤖 INPUT TO SUMMARIZER ---");
    console.log(JSON.stringify(summaryInput, null, 2));
    console.log("----------------------------\n");
    // --- END OF BLOCK ---

    // Produce a natural-language answer via Gemini
    const modelName = env("GEMINI_MODEL") || "gemini-2.5-flash";
    const answer = await naturalLanguageAnswerWithGemini(
      prompt || "",
      toolName,
      toolArgs,
      summaryInput, // Use the logged variable
      modelName
    );

    return res.json({ answer });
  } catch (e: any) {
    // --- 💥 UNCAUGHT EXCEPTION ---
    // This will catch any unexpected crashes in the function.
    console.error("\n--- 💥 UNCAUGHT EXCEPTION ---");
    console.error(e);
    console.error("--------------------------\n");
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
