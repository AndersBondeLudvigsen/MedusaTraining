import { MedusaService } from "@medusajs/framework/utils";
import { getMcp } from "../../lib/mcp/manager";
import { metricsStore, withToolLogging } from "../../lib/metrics/store";
import { ChartType, HistoryEntry, McpTool } from "./types";
import { extractToolJsonPayload, normalizeToolArgs } from "./utils";
import { buildChartFromAnswer, buildChartFromLatestTool } from "./charts";
import { planNextStepWithGemini } from "./planner";
import { collectGroundTruthNumbers } from "./validation";

type AskInput = {
  prompt: string;
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
};

class AssistantModuleService extends MedusaService({}) {
  private readonly maxSteps = 15;

  constructor(container: any, options: any = {}) {
    super(container, options);
  }

  async ask(input: AskInput): Promise<{
    answer?: string;
    chart: any | null;
    data: any | null;
    history: HistoryEntry[];
  }> {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new Error("Missing prompt");
    }

    const wantsChart = Boolean(input.wantsChart);
    const chartType: ChartType = input.chartType === "line" ? "line" : "bar";
    const chartTitle =
      typeof input.chartTitle === "string" ? input.chartTitle : undefined;

    const mcp = await getMcp();
    const tools = await mcp.listTools();
    let availableTools: McpTool[] = (tools.tools ?? []) as any;

    const history: HistoryEntry[] = [];

    const turnId = metricsStore.startAssistantTurn({ user: prompt });

    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 🔄 AGENT LOOP: STEP ${step + 1} ---`);

      const plan = await planNextStepWithGemini(
        prompt,
        availableTools,
        history,
        "gemini-2.5-flash",
        wantsChart,
        chartType
      );

      if (plan.action === "final_answer") {
        metricsStore.endAssistantTurn(turnId, plan.answer ?? "");

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
          ? buildChartFromAnswer(plan.answer, chartType, chartTitle) ||
            buildChartFromLatestTool(history, chartType, chartTitle) ||
            null
          : null;

        return {
          answer: plan.answer,
          chart,
          data: latestPayload ?? null,
          history,
        };
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

    metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
    throw new Error(
      "The agent could not complete the request within the maximum number of steps."
    );
  }
}

export default AssistantModuleService;
