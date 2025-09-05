import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { metricsStore } from "../../../lib/metrics/store";

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const summary = metricsStore.getSummary();
  return res.json(summary);
}
