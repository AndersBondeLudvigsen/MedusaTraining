import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { countOrdersInRange } from "../../../../lib/order-analytics"

// This endpoint is intended for MCP tool calls, protected by a shared secret header.
export const AUTHENTICATE = false

function parseLastDuration(input?: string): number | undefined {
  if (!input) return undefined
  const m = input.trim().match(/^(\d+)\s*([smhdwMy])$/)
  if (!m) return undefined
  const v = Number(m[1])
  const unit = m[2]
  const map: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  }
  return v * map[unit]
}

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

  const body = (req.body || {}) as { last?: string; from?: string; to?: string }

  const now = new Date()
  const toDate = parseDate(body.to) || now
  let fromDate = parseDate(body.from)
  if (!fromDate) {
    const ms = parseLastDuration(body.last) ?? parseLastDuration("30d")!
    fromDate = new Date(toDate.getTime() - ms)
  }
  if (fromDate > toDate) {
    return res.status(400).json({ message: "Invalid range: 'from' must be before 'to'" })
  }

  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const count = await countOrdersInRange({ orderService, from: fromDate, to: toDate })

  return res.status(200).json({
    ok: true,
    result: { count, range: { from: fromDate.toISOString(), to: toDate.toISOString() } },
  })
}

export default POST
