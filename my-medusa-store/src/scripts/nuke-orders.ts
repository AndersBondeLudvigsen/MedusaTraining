import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type Flags = {
  force: boolean
  dryRun: boolean
}

function parseFlags(argv: string[]): Flags {
  const args = new Set(argv.slice(2))
  const force =
    !!process.env.NUKE_ORDERS ||
    args.has("--force") ||
    args.has("-f")
  return {
    force,
    dryRun: !!process.env.NUKE_DRY_RUN || args.has("--dry-run"),
  }
}

async function listIds(query: any, entity: string): Promise<string[]> {
  try {
    const { data } = await query.graph({ entity, fields: ["id"], filters: {} })
    const ids = (data || []).map((d: any) => d.id).filter(Boolean)
    console.log(`[nuke-orders] ${entity}: ${ids.length} ids -> ${ids.join(",")}`)
    return ids
  } catch (e) {
    // Entity not available in this project; treat as empty
    return []
  }
}

function chunk<T>(arr: T[], size = 50): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function nukeOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const flags = parseFlags(process.argv)

  logger.info("Nuke Orders script starting…")
  if (!flags.force) {
    logger.error(
      "Refusing to run without confirmation. Re-run with --force or set NUKE_ORDERS=1."
    )
    logger.info("Optional flags: --dry-run")
    return
  }

  const dry = flags.dryRun
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      if (dry) {
        logger.info(`[dry-run] ${label}`)
        return
      }
      await fn()
      logger.info(`✔ ${label}`)
    } catch (e: any) {
      logger.warn(`⚠ Skipped ${label}: ${e?.message || String(e)}`)
    }
  }

  // Collect order and cart IDs upfront for visibility
  const orderData = {
    draftOrders: await listIds(query, "draft_order"),
    orders: await listIds(query, "order"),
    carts: await listIds(query, "cart"),
  }

  logger.info(
    `Summary before deletion: ` +
      Object.entries(orderData)
        .map(([k, v]) => `${k}=${(v as string[]).length}`)
        .join(", ")
  )

  if (orderData.draftOrders.length === 0 && orderData.orders.length === 0 && orderData.carts.length === 0) {
    logger.info("No orders, draft orders, or carts found to delete.")
    return
  }

  // 1) Delete carts first (to free ties to orders)
  await step("Soft delete carts (module)", async () => {
    if (!orderData.carts.length) return
    const cartModule: any = container.resolve(Modules.CART)
    for (const ids of chunk(orderData.carts)) {
      if (typeof cartModule.softDeleteCarts === "function") {
        await cartModule.softDeleteCarts(ids)
      } else if (typeof cartModule.deleteCarts === "function") {
        await cartModule.deleteCarts(ids)
      } else {
        throw new Error("CART module delete API not available")
      }
    }
  })

  // 2) Delete draft orders
  await step("Soft delete draft orders (module)", async () => {
    if (!orderData.draftOrders.length) return
    const orderModule: any = container.resolve(Modules.ORDER)
    for (const ids of chunk(orderData.draftOrders)) {
      if (typeof orderModule.softDeleteDraftOrders === "function") {
        await orderModule.softDeleteDraftOrders(ids)
      } else if (typeof orderModule.deleteDraftOrders === "function") {
        await orderModule.deleteDraftOrders(ids)
      } else {
        throw new Error("ORDER module draft order delete API not available")
      }
    }
  })

  // 3) Delete orders
  await step("Soft delete orders (module)", async () => {
    if (!orderData.orders.length) return
    const orderModule: any = container.resolve(Modules.ORDER)
    const before = orderData.orders.length
    for (const ids of chunk(orderData.orders)) {
      if (typeof orderModule.softDeleteOrders === "function") {
        await orderModule.softDeleteOrders(ids)
      } else if (typeof orderModule.deleteOrders === "function") {
        await orderModule.deleteOrders(ids)
      } else {
        throw new Error("ORDER module delete API not available")
      }
    }
    
    // Best-effort visibility: re-query count
    try {
      const remaining = await listIds(query, "order")
      console.log(`[nuke-orders] orders before=${before} after=${remaining.length}`)
    } catch {}
  })

  logger.info("Nuke Orders script finished.")
  logger.info("💡 Note: This script only deletes orders, draft orders, and carts.")
  logger.info("💡 Other entities like customers, products, etc. remain untouched.")
}
