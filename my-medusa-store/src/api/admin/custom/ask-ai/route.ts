import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GoogleGenerativeAI } from "@google/generative-ai"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as any
  const question = (body?.question ?? "").toString().trim()

  if (!question) {
    res.status(400).json({ error: "Missing 'question'", answer: "" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  let orders: any[] = []
  try {
    const result = (await query.graph({
      entity: "order",
      fields: [
        "id",
        "created_at",
        "currency_code",
  "total",
        "items.title",
        "items.quantity",
        "items.unit_price",
  "items.total",
  "items.subtotal",
        "items.variant_id",
        "items.variant.product.title",
  "shipping_methods.amount",
      ],
    })) as { data: any[] }
    orders = Array.isArray(result?.data) ? result.data : []
  } catch (e: any) {
    res.status(500).json({ error: `Failed to load orders: ${e?.message || e}`, answer: "" })
    return
  }
  // Sort by total and limit to 50
  orders.sort((a, b) => (b.total || 0) - (a.total || 0));
  orders = orders.slice(0, 50)

  // If no orders, return explicit error (no AI fallback)
  if (!orders.length) {
    res.status(404).json({ error: "Ingen ordrer fundet." })
    return
  }

  // Build context lines with a computed total from items + shipping
  const productQty = new Map<string, number>()
  const productRevenueByCurrency = new Map<string, Map<string, number>>() // title -> (ccy -> cents)
  const revenueByCurrency: Record<string, number> = {}
  const lines = orders.map((o: any) => {
    const currency = String(o?.currency_code || '').toUpperCase()
    const items = Array.isArray(o?.items) ? o.items : []
    let itemsTotal = 0
    for (const it of items) {
      const qty = Number(it?.quantity || 0)
      const unit = Number((it as any)?.unit_price)
      const lineTotalCandidate = Number((it as any)?.total ?? (it as any)?.subtotal)
      const lineTotal = Number.isFinite(lineTotalCandidate) && lineTotalCandidate > 0
        ? lineTotalCandidate
        : (Number.isFinite(unit) && unit > 0 ? unit * qty : 0)
      itemsTotal += lineTotal

      const title = it?.title || it?.variant?.product?.title || "(ukendt produkt)"
      productQty.set(title, (productQty.get(title) || 0) + qty)
      if (currency) {
        let byCcy = productRevenueByCurrency.get(title)
        if (!byCcy) {
          byCcy = new Map<string, number>()
          productRevenueByCurrency.set(title, byCcy)
        }
        byCcy.set(currency, (byCcy.get(currency) || 0) + lineTotal)
      }
    }
    const shippingMethods: any[] = Array.isArray((o as any).shipping_methods) ? (o as any).shipping_methods : []
    const shippingTotal = shippingMethods.reduce((sum: number, sm: any) => sum + Number(sm?.amount || 0), 0)
    const computedTotal = Number(o.total) > 0 ? Number(o.total) : itemsTotal + shippingTotal;
    if (currency) {
      revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + computedTotal
    }
    const date = o?.created_at ? new Date(o.created_at).toISOString().split('T')[0] : ''
    const itemStr = items.map((it: any) => {
      const qty = Number(it?.quantity || 0)
      const unit = Number((it as any)?.unit_price)
      const lineTotalCandidate = Number((it as any)?.total ?? (it as any)?.subtotal)
      const lineTotal = Number.isFinite(lineTotalCandidate) && lineTotalCandidate > 0
        ? lineTotalCandidate
        : (Number.isFinite(unit) && unit > 0 ? unit * qty : 0)
      return `${it.title} x${qty} = ${(lineTotal/100).toFixed(2)} ${currency}`
    }).join(', ')
    return {
      id: o.id,
      currency,
      computed_total_cents: computedTotal,
      computed_total: `${(computedTotal/100).toFixed(2)} ${currency}`,
      date,
      items: itemStr,
    }
  })

  // Build a compact product summary to guide the model
  const topQty = Array.from(productQty.entries()).sort((a,b) => b[1]-a[1]).slice(0, 5)
  const prodSummary = topQty.map(([title]) => {
    const qty = productQty.get(title) || 0
    const revMap = productRevenueByCurrency.get(title) || new Map<string, number>()
    const revStr = Array.from(revMap.entries()).map(([ccy, cents]) => `${(cents/100).toFixed(2)} ${ccy}`).join(', ')
    return `• ${title}: ${qty} stk, omsætning ${revStr || '0.00'}`
  }).join('\n')
  const revenueStr = Object.entries(revenueByCurrency).map(([ccy, cents]) => `${(cents/100).toFixed(2)} ${ccy}`).join(', ')

  // Prepare Gemini prompt that explicitly instructs to use computed_total
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: "Mangler GEMINI_API_KEY/GOOGLE_API_KEY miljøvariabel." })
    return
  }

  const table = lines.map(l => `- ${l.id} | ${l.date} | ${l.computed_total} | ${l.items}`).join('\n')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
  const prompt = `Du er en hjælpsom AI-assistent for en Medusa-butik. Brug KUN de beregnede totaler nedenfor (computed_total) og produktopsummeringen til at besvare spørgsmålet. Svar kort og præcist på dansk.\n\nBrugerens spørgsmål:\n${question}\n\nAggregeret opsummering (seneste ${lines.length} ordrer):\nTotal omsætning: ${revenueStr}\nTop produkter (antal og omsætning):\n${prodSummary}\n\nSeneste ${lines.length} ordrer (id | dato | computed_total | items):\n${table}\n\nReturnér kun svaret, uden ekstra forklaring.`

  try {
    const result = await model.generateContent(prompt)
    const text = result?.response?.text?.() || ""
    const answer = text.trim()
    if (!answer) {
      res.status(502).json({ error: "Tomt AI-svar." })
      return
    }
    res.json({ answer })
  } catch (e: any) {
    res.status(502).json({ error: `Kunne ikke hente AI-svar: ${e?.message || e}` })
  }
}
