import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { topProductsByQuantity } from "../../../../lib/order-analytics"

export const AUTHENTICATE = false

function parseDate(input?: string): Date | undefined {
  if (!input) return undefined
  const d = new Date(input)
  return isNaN(d.getTime()) ? undefined : d
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const secret = process.env.MCP_TOOL_SECRET || ""
  const header = (req.headers["x-mcp-tool-secret"] || req.headers["X-MCP-Tool-Secret"]) as string | undefined
  if (!secret || header !== secret) {
    return res.status(401).json({ message: "Unauthorized MCP tool call" })
  }

  const body = (req.body || {}) as { from?: string; to?: string; limit?: number }
  const now = new Date()
  const toDate = parseDate(body.to) || now
  const fromDate = parseDate(body.from) || new Date(toDate.getTime() - 30 * 24 * 3600 * 1000)
  const limit = Number(body.limit ?? 5)

  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const items = await topProductsByQuantity({ orderService, from: fromDate, to: toDate, limit })

  return res.status(200).json({ ok: true, result: { items, range: { from: fromDate.toISOString(), to: toDate.toISOString() } } })
}

export default POST
