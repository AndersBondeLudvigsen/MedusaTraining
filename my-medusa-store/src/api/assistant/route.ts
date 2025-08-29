import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";

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

    // Tool selection: if body.tool provided, use it. Otherwise pick by keyword.
    let toolName = body.tool;
    if (!toolName && prompt) {
      const text = prompt.toLowerCase();
      const candidates = tools.tools?.map(t => t.name) ?? [];
      // crude heuristics
      const picks = [
        { kw: ["product", "products", "items"], re: /product/i },
        { kw: ["order", "orders"], re: /order/i },
        { kw: ["customer", "customers"], re: /customer/i },
        { kw: ["region", "regions"], re: /region/i },
        { kw: ["currency", "currencies"], re: /currenc/i },
      ];
      for (const p of picks) {
        if (p.kw.some(k => text.includes(k))) {
          toolName = candidates.find(n => p.re.test(n));
          if (toolName) break;
        }
      }
      // fallback to first tool
      if (!toolName) toolName = candidates[0];
    }

    if (!toolName) {
      await mcp.close();
      return res.json({
        message: "No tools available from MCP server.",
        tools: tools.tools ?? [],
      });
    }

    const toolArgs = body.args ?? {};
    const result = await mcp.callTool(toolName, toolArgs);

    // Make a user-friendly answer if possible
    let answer: string | undefined;
    const textContent = result.content?.find(c => c.type === "text");
    if (textContent && "text" in textContent) {
      answer = textContent.text as string;
    }

    return res.json({
      selectedTool: toolName,
      result,
      answer: answer ?? "Tool executed successfully.",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
