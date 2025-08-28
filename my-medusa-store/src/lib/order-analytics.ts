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
