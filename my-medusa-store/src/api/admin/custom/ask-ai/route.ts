import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

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
      // We’ll fetch needed fields; we'll sort client-side and take 50
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
    res.status(500).json({
      error: `Failed to load orders: ${e?.message || e}`,
      answer: "",
    })
    return
  }

  // Sort newest first and limit to 50
  orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  orders = orders.slice(0, 50)

  // Build product stats by title
  type Stat = { qty: number; revenueByCurrency: Record<string, number> }
  const productStats = new Map<string, Stat>()
  let totalRevenueByCurrency: Record<string, number> = {}
  let totalOrders = orders.length
  let totalOrderValueByCurrency: Record<string, number> = {}

  for (const order of orders) {
    const currency = order?.currency_code || ""
    const total = Number(order?.total || 0)
    if (currency) {
      totalRevenueByCurrency[currency] = (totalRevenueByCurrency[currency] || 0) + total
      totalOrderValueByCurrency[currency] = (totalOrderValueByCurrency[currency] || 0) + total
    }
    const items: any[] = Array.isArray(order?.items) ? order.items : []
    for (const it of items) {
      const title = it?.title || it?.variant?.product?.title || "(ukendt produkt)"
      const qty = Number(it?.quantity || 0)
      const unitPrice = Number(it?.unit_price || 0)
      let stat = productStats.get(title)
      if (!stat) {
        stat = { qty: 0, revenueByCurrency: {} }
        productStats.set(title, stat)
      }
      stat.qty += qty
      if (currency) {
        stat.revenueByCurrency[currency] = (stat.revenueByCurrency[currency] || 0) + unitPrice * qty
      }
    }
  }

  // Simple intent detection from the question
  const q = question.toLowerCase()
  const isLargest =
    q.includes("største") ||
    q.includes("størst") ||
    q.includes("largest") ||
    q.includes("biggest") ||
    q.includes("højeste")
  const isBestSelling = q.includes("best") || q.includes("bedst") || q.includes("sælgende") || q.includes("topseller")
  const isRevenue = q.includes("revenue") || q.includes("omsætning") || q.includes("oms")
  const isAvg = q.includes("average") || q.includes("gennemsnit") || q.includes("avg")
  const isCount = q.includes("count") || q.includes("antal") || q.includes("orders")

  function formatCurrencyMap(m: Record<string, number>): string {
    const parts = Object.entries(m).map(([ccy, amt]) => `${(amt / 100).toFixed(2)} ${ccy.toUpperCase()}`)
    return parts.join(", ") || "0"
  }

  let answer = ""
  if (isLargest) {
    if (!orders.length) {
      answer = "Ingen ordrer fundet."
    } else {
      const maxOrder = orders.reduce((max: any, o: any) => (Number(o?.total || 0) > Number(max?.total || 0) ? o : max), orders[0])
      const amt = Number(maxOrder?.total || 0)
      const currency = (maxOrder?.currency_code || '').toUpperCase()
      const when = maxOrder?.created_at ? new Date(maxOrder.created_at).toLocaleString() : "ukendt tidspunkt"
      answer = `Den største ordre (seneste ${totalOrders} ordre) er ${maxOrder?.id || "(uden id)"} på ${(amt / 100).toFixed(2)} ${currency} fra ${when}.`
    }
  } else if (isBestSelling) {
    const top = Array.from(productStats.entries()).sort((a, b) => b[1].qty - a[1].qty)[0]
    if (top) {
      answer = `Bedst sælgende produkt i de seneste ${totalOrders} ordre: ${top[0]} (${top[1].qty} stk).`
    } else {
      answer = "Ingen ordrer fundet."
    }
  } else if (isRevenue) {
    answer = `Samlet omsætning for de seneste ${totalOrders} ordre: ${formatCurrencyMap(totalRevenueByCurrency)}`
  } else if (isAvg) {
    const avgByCurrency: Record<string, number> = {}
    for (const [ccy, sum] of Object.entries(totalOrderValueByCurrency)) {
      avgByCurrency[ccy] = sum / Math.max(1, totalOrders)
    }
    answer = `Gennemsnitlig ordreværdi (seneste ${totalOrders} ordre): ${formatCurrencyMap(avgByCurrency)}`
  } else if (isCount) {
    answer = `Antal ordrer analyseret: ${totalOrders}`
  } else {
    // Default: top 3 products by quantity
    const top3 = Array.from(productStats.entries())
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 3)
      .map(([title, stat]) => `${title} (${stat.qty})`)
    answer = top3.length
      ? `Top 3 produkter (seneste ${totalOrders} ordre): ${top3.join(", ")}`
      : "Ingen ordrer fundet."
  }

  res.json({ answer })
}
