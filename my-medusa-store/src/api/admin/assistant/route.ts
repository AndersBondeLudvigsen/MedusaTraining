import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../modules/assistant/service";
import { ASSISTANT_MODULE } from "../../../modules/assistant";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as {
      prompt?: string;
      wantsChart?: boolean;
      chartType?: "bar" | "line";
      chartTitle?: string;
    };

    const prompt = body.prompt?.trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const assistant = req.scope.resolve<AssistantModuleService>(ASSISTANT_MODULE);
    const result = await assistant.ask({
      prompt,
      wantsChart: Boolean(body.wantsChart),
      chartType: body.chartType === "line" ? "line" : "bar",
      chartTitle: typeof body.chartTitle === "string" ? body.chartTitle : undefined,
    });

    return res.json(result);
  } catch (e: any) {
    console.error("\n--- 💥 ASSISTANT ROUTE ERROR ---\n", e);
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}

