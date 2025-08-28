import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { countOrdersInRange } from "../../../../lib/order-analytics"

// Require admin authentication for this endpoint
export const AUTHENTICATE = true

type DurationUnit = "s" | "m" | "h" | "d" | "w" | "M" | "y"

function parseLastDuration(input?: string): number | undefined {
  if (!input) return undefined
  const match = input.trim().match(/^(\d+)\s*([smhdwMy])$/)
  if (!match) return undefined
  const value = Number(match[1])
  const unit = match[2] as DurationUnit
  const msPer: Record<DurationUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000, // approximate month
    y: 365 * 24 * 60 * 60 * 1000, // approximate year
  }
  return value * msPer[unit]
}

function parseDate(input?: string): Date | undefined {
  if (!input) return undefined
  const d = new Date(input)
  return isNaN(d.getTime()) ? undefined : d
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { from, to, last } = (req.query || {}) as {
    from?: string
    to?: string
    last?: string
  }

  const now = new Date()
  const toDate = parseDate(to) || now
  let fromDate = parseDate(from)

  if (!fromDate) {
    const lastMs = parseLastDuration(last) ?? parseLastDuration("30d")!
    fromDate = new Date(toDate.getTime() - lastMs)
  }

  // Guard against invalid ranges
  if (fromDate > toDate) {
    return res.status(400).json({
      message: "Invalid range: 'from' must be before 'to'",
    })
  }

  const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
  const count = await countOrdersInRange({ orderService, from: fromDate, to: toDate })

  return res.status(200).json({
    count,
    range: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
  })
}

export default GET
