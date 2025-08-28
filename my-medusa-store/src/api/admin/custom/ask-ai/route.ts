import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { countOrdersInRange, topProductsByQuantity } from "../../../../lib/order-analytics"
import { connectMcp, callTool } from "../../../../lib/mcp/client"

export const AUTHENTICATE = true

type Range = { from: Date; to: Date }

const clampRange = (r: Range) => {
  // safety: ensure range doesn't exceed a year unless explicitly specified
  const maxSpanMs = 366 * 24 * 60 * 60 * 1000
  if (r.to.getTime() - r.from.getTime() > maxSpanMs) {
    return { from: new Date(r.to.getTime() - maxSpanMs), to: r.to }
  }
  return r
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function parseHumanRange(text: string): Range | undefined {
  const t = text.toLowerCase()
  const now = new Date()

  // today
  if (/\b(today|i dag|idag)\b/.test(t)) {
    return { from: startOfDay(now), to: now }
  }
  // yesterday
  if (/\b(yesterday|i går|igår)\b/.test(t)) {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return { from: startOfDay(y), to: endOfDay(y) }
  }
  // last week
  if (/\b(last\s*week|sidste\s*uge)\b/.test(t)) {
    const to = now
    const from = new Date(to)
    from.setDate(from.getDate() - 7)
    return { from, to }
  }
  // last month (~30d)
  if (/\b(last\s*month|sidste\s*måned)\b/.test(t)) {
    const to = now
    const from = new Date(to)
    from.setDate(from.getDate() - 30)
    return { from, to }
  }

  // "last 7d" / "last 24h" / "last 2 weeks" / "last 3 months"
  const m = t.match(/last\s*(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|s|m|h|d|w|M|y)/)
  if (m) {
    const value = Number(m[1])
    const unit = m[2]
    const to = now
    const from = new Date(to)
    const map: Record<string, number> = {
      s: 1, second: 1, seconds: 1,
      m: 60, minute: 60, minutes: 60,
      h: 3600, hour: 3600, hours: 3600,
      d: 86400, day: 86400, days: 86400,
      w: 7 * 86400, week: 7 * 86400, weeks: 7 * 86400,
      M: 30 * 86400, month: 30 * 86400, months: 30 * 86400,
      y: 365 * 86400, year: 365 * 86400, years: 365 * 86400,
    }
    const secs = (map[unit] ?? 0) * value
    if (secs > 0) {
      from.setSeconds(from.getSeconds() - secs)
      return { from, to }
    }
  }

  // explicit ISO dates: from 2025-08-01 to 2025-08-28
  const m2 = t.match(/from\s+(\d{4}-\d{2}-\d{2})(?:t\S+)?\s+to\s+(\d{4}-\d{2}-\d{2})(?:t\S+)?/)
  if (m2) {
    const from = new Date(m2[1])
    const to = endOfDay(new Date(m2[2]))
    if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
      return { from, to }
    }
  }

  return undefined
}

function looksLikeOrderCount(text: string): boolean {
  const t = text.toLowerCase()
  return /(how many|how\s*many\s*orders|antal\s*ordrer|hvor\s*mange\s*ordrer|orders\s*count)/.test(t)
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body || {}) as { question?: string }
  const question = String(body?.question || "").trim()
  if (!question) {
    return res.status(400).json({ message: "Missing 'question'" })
  }

  // Skill-first: if the question matches order count, answer locally
  if (looksLikeOrderCount(question)) {
    const rng = clampRange(
      parseHumanRange(question) ?? { from: new Date(Date.now() - 30 * 86400_000), to: new Date() }
    )
    const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
    const count = await countOrdersInRange({ orderService, from: rng.from, to: rng.to })
    const answer = `Antal ordrer i perioden ${rng.from.toISOString()} – ${rng.to.toISOString()}: ${count}.`
    return res.status(200).json({ answer, meta: { intent: "orders.count", range: { from: rng.from, to: rng.to }, count } })
  }

  // Single-process MCP client approach: spawn/connect to medusa-mcp via stdio and call tools directly
  const mcpBin = process.env.MCP_BIN
  if (!mcpBin) {
    return res.status(200).json({
      answer: "MCP_BIN mangler. Sæt MCP_BIN til din medusa-mcp entry (node \\path\\to\\dist\\index.js).",
      meta: { intent: "mcp.missing_bin" },
    })
  }

  // Heuristics for a small demo:
  // - If question mentions listing/finding products with a term, use a store products list tool.
  // - Otherwise, fall back to a friendly message.
  const t = question.toLowerCase()
  try {
    // Keep our richer local 'top products' skill available
    if (/(most\s*sold|best\s*selling|mest\s*solgte|bedst\s*sælgende)/.test(t)) {
      const now = new Date()
      const to = now
      const from = /last\s*month|sidste\s*måned/.test(t)
        ? new Date(now.getTime() - 30 * 24 * 3600 * 1000)
        : new Date(now.getTime() - 7 * 24 * 3600 * 1000)
      const orderService = req.scope.resolve<IOrderModuleService>(Modules.ORDER)
      const items = await topProductsByQuantity({ orderService, from, to, limit: 5 })
      if (!items.length) {
        return res.status(200).json({ answer: "Ingen produkter i perioden." })
      }
      const top = items[0]
      const title = top.title || top.sku || top.variant_id || "Ukendt"
      const answer = `Mest solgte produkt: ${title} (${top.quantity} stk)`
      return res.status(200).json({ answer, meta: { intent: "products.top", items } })
    }

    // Connect to medusa-mcp via stdio
    const session = await connectMcp()
    try {
      // Try to discover a products list tool and call it with a basic query
      // @ts-ignore - SDK types may vary; using any-safe call
      const toolsList: any = await (session.client as any).listTools?.() || { tools: [] }
      const tools: any[] = toolsList.tools || []
      const prodTool = tools.find((x) => /product/i.test(x.name) && /list|get/i.test(x.name)) || tools.find((x) => /products/i.test(x.name))

      if (/products?\s+(containing|with)\s+([\w-]+)/.test(t) && prodTool) {
        const term = t.match(/products?\s+(containing|with)\s+([\w-]+)/)![2]
        const { text } = await callTool(session, prodTool.name, { q: term })
        const answer = text || `Listed products for query: ${term}`
        return res.status(200).json({ answer, meta: { intent: "mcp.products.search", tool: prodTool.name } })
      }

      // As a generic example, if user says 'list products', call the tool without params
      if (/list\s+products/.test(t) && prodTool) {
        const { text } = await callTool(session, prodTool.name, {})
        const answer = text || `Listed products.`
        return res.status(200).json({ answer, meta: { intent: "mcp.products.list", tool: prodTool.name } })
      }

      return res.status(200).json({
        answer: "Fortæl mig hvad du ønsker fra Medusa (fx 'list products with shirt'). Jeg kan også udvide med flere værktøjer.",
        meta: { intent: "mcp.unsupported" },
      })
    } finally {
      await session.dispose()
    }
  } catch (e: any) {
    return res.status(500).json({
      answer: "MCP-forespørgsel mislykkedes. Tjek at medusa-mcp kan startes fra MCP_BIN.",
      error: e?.message || String(e),
      meta: { intent: "mcp.error" },
    })
  }
}

export default POST
