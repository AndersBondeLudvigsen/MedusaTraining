import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { metricsStore } from "../../../lib/metrics/store";

// Return JSON only; UI is handled by the Admin page at src/admin/routes/internal/metrics/page.tsx
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const summary = metricsStore.getSummary();
  return res.json(summary);
}
