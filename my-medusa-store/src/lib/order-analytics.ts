import type { IOrderModuleService } from "@medusajs/types"

export type CountOrdersInput = {
  orderService: IOrderModuleService
  from: Date
  to: Date
}

export async function countOrdersInRange({
  orderService,
  from,
  to,
}: CountOrdersInput): Promise<number> {
  const filter = {
    created_at: {
      $gte: from.toISOString(),
      $lte: to.toISOString(),
    },
  } as any

  // If the module provides a direct count method, prefer it
  const maybeCount = (orderService as any).countOrders
  if (typeof maybeCount === "function") {
    return await maybeCount(filter)
  }

  const [, count] = await orderService.listAndCountOrders(filter, {
    select: ["id"],
    take: 1,
    skip: 0,
  })
  return count
}

export type TopProductsInput = CountOrdersInput & {
  limit?: number
}

export type TopProduct = {
  product_id?: string
  variant_id?: string
  title?: string
  sku?: string
  quantity: number
}

// Minimal aggregation for demo purposes; for large datasets, replace with a proper analytical query or workflow.
export async function topProductsByQuantity({ orderService, from, to, limit = 5 }: TopProductsInput): Promise<TopProduct[]> {
  const filter: any = {
    created_at: {
      $gte: from.toISOString(),
      $lte: to.toISOString(),
    },
  }

  const take = 100
  let skip = 0
  const totals = new Map<string, TopProduct>()

  // page through orders to aggregate items
  // stop early if pages return empty
  // Note: This is a simple demo aggregator; optimize as needed.
  for (let i = 0; i < 50; i++) {
    const [orders] = await orderService.listAndCountOrders(filter, {
      select: ["id"],
      relations: ["items", "items.variant", "items.variant.product"],
      take,
      skip,
    } as any)

    if (!orders?.length) break

    for (const o of orders as any[]) {
      const items = o.items || []
      for (const it of items) {
        const key = it.variant_id || it.product_id || it.id
        if (!key) continue
        const qty = Number(it.quantity || 0)
        const existing = totals.get(key) || {
          product_id: it.product_id || it?.variant?.product_id,
          variant_id: it.variant_id,
          title: it.title || it?.variant?.title || it?.variant?.product?.title,
          sku: it?.variant?.sku,
          quantity: 0,
        }
        existing.quantity += qty
        totals.set(key, existing)
      }
    }

    skip += take
  }

  return Array.from(totals.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, Math.max(1, limit))
}
