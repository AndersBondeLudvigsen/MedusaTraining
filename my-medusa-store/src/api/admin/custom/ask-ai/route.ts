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
        "items.variant_id",
        "items.variant.product.title",
      ],
    })) as { data: any[] }
    orders = Array.isArray(result?.data) ? result.data : []
  } catch (e: any) {
    res.status(500).json({ error: `Failed to load orders: ${e?.message || e}`, answer: "" })
    return
  }
  // Sort newest first and limit to 50
  orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  orders = orders.slice(0, 50)

  // If no orders, return explicit error (no AI fallback)
  if (!orders.length) {
    res.status(404).json({ error: "Ingen ordrer fundet." })
    return
  }

  // Build context lines with a computed total from items + shipping
  const lines = orders.map((o: any) => {
    const currency = String(o?.currency_code || '').toUpperCase()
    const items = Array.isArray(o?.items) ? o.items : []
    const itemsTotal = items.reduce((sum: number, it: any) => sum + Number(it?.unit_price || 0) * Number(it?.quantity || 0), 0)
    const shippingMethods: any[] = Array.isArray((o as any).shipping_methods) ? (o as any).shipping_methods : []
    const shippingTotal = shippingMethods.reduce((sum: number, sm: any) => sum + Number(sm?.amount || 0), 0)
    const computedTotal = itemsTotal + shippingTotal
    const date = o?.created_at ? new Date(o.created_at).toISOString().split('T')[0] : ''
    const itemStr = items.map((it: any) => `${it.title} x${it.quantity} @ ${(Number(it.unit_price||0)/100).toFixed(2)} ${currency}`).join(', ')
    return {
      id: o.id,
      currency,
      computed_total_cents: computedTotal,
      computed_total: `${(computedTotal/100).toFixed(2)} ${currency}`,
      date,
      items: itemStr,
    }
  })

  // Prepare Gemini prompt that explicitly instructs to use computed_total
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: "Mangler GEMINI_API_KEY/GOOGLE_API_KEY miljøvariabel." })
    return
  }

  const table = lines.map(l => `- ${l.id} | ${l.date} | ${l.computed_total} | ${l.items}`).join('\n')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
  const prompt = `Du er en hjælpsom AI-assistent for en Medusa-butik. Brug KUN de beregnede totaler nedenfor (computed_total) til at besvare spørgsmålet. Svar kort og præcist på dansk.\n\nBrugerens spørgsmål:\n${question}\n\nSeneste ${lines.length} ordrer (id | dato | computed_total | items):\n${table}\n\nReturnér kun svaret, uden ekstra forklaring.`

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
