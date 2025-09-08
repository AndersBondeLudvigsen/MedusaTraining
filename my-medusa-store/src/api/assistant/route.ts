import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getMcp } from "../../lib/mcp/manager";
import { metricsStore, withToolLogging } from "../../lib/metrics/store";
import { McpTool, HistoryEntry, ChartType } from "./types";
import { extractToolJsonPayload, normalizeToolArgs } from "./utils";
import { buildChartFromLatestTool } from "./charts";
import { planNextStepWithGemini } from "./service";
import { collectGroundTruthNumbers } from "./validation";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as {
      prompt?: string;
      wantsChart?: boolean;
      chartType?: ChartType;
      chartTitle?: string;
      category?: string; // New category filter
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const wantsChart = Boolean(body.wantsChart);
    const chartType: ChartType = body.chartType === "line" ? "line" : "bar";
    const chartTitle =
      typeof body.chartTitle === "string" ? body.chartTitle : undefined;
    const category = typeof body.category === "string" ? body.category : null;

    console.log(`\n🚀 ASSISTANT REQUEST RECEIVED:`);
    console.log(
      `   Prompt: "${prompt.substring(0, 50)}${
        prompt.length > 50 ? "..." : ""
      }"`
    );
    console.log(`   Category: ${category || "none"}`);
    console.log(`   Wants Chart: ${wantsChart}`);
    console.log(`   Chart Type: ${chartType}`);
    console.log(`   Chart Title: ${chartTitle || "none"}`);

    const mcp = await getMcp();

    // Get all available tools
    const tools = await mcp.listTools();
    let availableTools: McpTool[] = (tools.tools ?? []) as any;

    console.log(`\n🔧 TOOL AVAILABILITY:`);
    console.log(`   Total tools available: ${availableTools.length}`);
    console.log(
      `   Category guidance: ${category || "general"} (all tools accessible)`
    );
    // Note: Category only affects the AI prompt, not tool filtering

    const history: HistoryEntry[] = [];
    const maxSteps = 15;

    // 🔸 START assistant turn
    const turnId = metricsStore.startAssistantTurn({ user: prompt });

    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);

      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        "gemini-2.5-flash",
        wantsChart,
        category || undefined,
        chartType
      );

      if (plan.action === "final_answer") {
        console.log("✅ AI decided to provide the final answer.");

        // 🔸 END turn with final message
        metricsStore.endAssistantTurn(turnId, plan.answer ?? "");

        // 🔸 Auto-validate the answer using any grounded numbers we collected
        const t = metricsStore.getLastTurn?.();
        const grounded = t?.groundedNumbers ?? {};
        for (const [label, value] of Object.entries(grounded)) {
          if (typeof value === "number") {
            metricsStore.autoValidateFromAnswer(turnId, label, value, 0);
          }
        }

        const latestPayload = extractToolJsonPayload(
          history[history.length - 1]?.tool_result
        );
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

        metricsStore.noteToolUsed(turnId, plan.tool_name);

        const normalizedArgs = normalizeToolArgs(plan.tool_args);
        if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
          console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
        }

        const result = await withToolLogging(
          plan.tool_name,
          normalizedArgs,
          async () => {
            return mcp.callTool(plan.tool_name!, normalizedArgs);
          }
        );

        console.log(
          `   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`
        );

        const payload = extractToolJsonPayload(result);
        const truth = collectGroundTruthNumbers(payload);
        if (truth) {
          metricsStore.provideGroundTruth(turnId, truth);
        }

        history.push({
          tool_name: plan.tool_name,
          tool_args: normalizedArgs,
          tool_result: result,
        });
      } else {
        throw new Error("AI returned an invalid plan. Cannot proceed.");
      }
    }

    // If we got here, we exceeded max steps
    metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
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
