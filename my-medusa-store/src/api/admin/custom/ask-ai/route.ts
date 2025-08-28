import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { countOrdersInRange } from "../../../../lib/order-analytics"

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

  // Fallback: call MCP agent with a minimal tool manifest.
  const mcpUrl = process.env.MCP_SERVER_URL
  const mcpToken = process.env.MCP_SERVER_TOKEN
  const toolSecret = process.env.MCP_TOOL_SECRET

  if (!mcpUrl || !mcpToken || !toolSecret) {
    return res.status(200).json({
      answer:
        "AI fallback ikke konfigureret (MCP_SERVER_URL/MCP_SERVER_TOKEN/MCP_TOOL_SECRET mangler). Jeg kan stadig svare på ordretælling.",
      meta: { intent: "fallback.local" },
    })
  }

  try {
  const publicBase = process.env.MEDUSA_PUBLIC_URL || `${req.protocol}://${req.get("host")}`
  const toolSpec = {
      name: "count_orders",
      description: "Return the order count for a given time range.",
      parameters: {
        type: "object",
        properties: {
          last: { type: "string", description: "Duration like 7d, 24h" },
          from: { type: "string", description: "ISO date" },
          to: { type: "string", description: "ISO date" },
        },
      },
      // The AI will call this URL; prefer a public base if configured
      invocation: {
        method: "POST",
        url: `${publicBase}/admin/tools/count-orders`,
        headers: { "X-MCP-Tool-Secret": toolSecret },
      },
    }

    const payload = {
      question,
      tools: [toolSpec],
      // Optionally give some context for better answers
      system: "You are a helpful commerce analyst. Use tools as needed to answer precisely.",
    }

    const r = await fetch(`${mcpUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!r.ok) {
      const text = await r.text().catch(() => "")
      throw new Error(text || `MCP responded ${r.status}`)
    }
    const data = await r.json()
    // Expecting { answer: string, meta?: any }
    const answer = data?.answer || ""
    return res.status(200).json({ answer, meta: { intent: "mcp", raw: data } })
  } catch (e: any) {
    return res.status(500).json({
      answer: "MCP-forespørgsel mislykkedes. Prøv igen senere.",
      error: e?.message || String(e),
      meta: { intent: "mcp.error" },
    })
  }
}

export default POST
