import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  // Prefer workflows where available for cascading deletes
  deleteProductsWorkflow,
  deleteRegionsWorkflow,
  deleteSalesChannelsWorkflow,
  deleteShippingOptionsWorkflow,
  deleteStockLocationsWorkflow,
  deleteTaxRegionsWorkflow,
  deleteProductCategoriesWorkflow,
  deletePriceListsWorkflow,
  deleteCustomerGroupsWorkflow,
  deleteApiKeysWorkflow,
  deleteDraftOrdersWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Nuke script: deletes most data created during development.
 *
 * Safety:
 * - Requires one of: env NUKE_ALL=1 | --force flag
 * - Dry run supported via --dry-run
 * - Preserve subsets via --preserve-store, --preserve-users
 *
 * Design notes (SOLID/GRASP):
 * - SRP: each step handles a specific aggregate (products, orders, ...)
 * - OCP: easy to extend with new steps without modifying others
 * - DIP: interact via container-resolved module services and workflows
 * - Low coupling: helper utilities isolate query + deletion orchestration
 */

type Flags = {
  force: boolean
  dryRun: boolean
  preserveStore: boolean
  preserveUsers: boolean
}

function parseFlags(argv: string[]): Flags {
  const args = new Set(argv.slice(2))
  const force = !!process.env.NUKE_ALL || args.has("--force") || args.has("-f")
  return {
    force,
    dryRun: args.has("--dry-run"),
    preserveStore: args.has("--preserve-store"),
    preserveUsers: args.has("--preserve-users"),
  }
}

async function listIds(query: any, entity: string): Promise<string[]> {
  const { data } = await query.graph({ entity, fields: ["id"], filters: {} })
  return (data || []).map((d: any) => d.id).filter(Boolean)
}

function chunk<T>(arr: T[], size = 50): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function nukeAll({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const flags = parseFlags(process.argv)

  logger.info("Nuke script starting…")
  if (!flags.force) {
    logger.error(
      "Refusing to run without confirmation. Re-run with --force or set NUKE_ALL=1."
    )
    logger.info(
      "Optional flags: --dry-run --preserve-store --preserve-users"
    )
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

  // Collect IDs upfront for visibility
  const catalog = {
    products: await listIds(query, "product"),
    productCategories: await listIds(query, "product_category"),
    priceLists: await listIds(query, "price_list"),
    inventoryItems: await listIds(query, "inventory_item"),
    stockLocations: await listIds(query, "stock_location"),
    shippingOptions: await listIds(query, "shipping_option"),
    fulfillmentSets: await listIds(query, "fulfillment_set"),
    salesChannels: await listIds(query, "sales_channel"),
    regions: await listIds(query, "region"),
    taxRegions: await listIds(query, "tax_region"),
    apiKeys: await listIds(query, "api_key"),
    customerGroups: await listIds(query, "customer_group"),
    draftOrders: await listIds(query, "draft_order"),
    orders: await listIds(query, "order"),
    customers: await listIds(query, "customer"),
    carts: await listIds(query, "cart"),
    users: await listIds(query, "user"),
    stores: await listIds(query, "store"),
  }

  logger.info(
    `Summary before deletion: ` +
      Object.entries(catalog)
        .map(([k, v]) => `${k}=${(v as string[]).length}`)
        .join(", ")
  )

  // 1) Orders and carts first (to free ties to items, inventory, etc.)
  await step("Soft delete draft orders (module)", async () => {
    if (!catalog.draftOrders.length) return
    const orderModule: any = container.resolve(Modules.ORDER)
    for (const ids of chunk(catalog.draftOrders)) {
      if (typeof orderModule.softDeleteDraftOrders === "function") {
        await orderModule.softDeleteDraftOrders(ids)
      } else if (typeof orderModule.deleteDraftOrders === "function") {
        await orderModule.deleteDraftOrders(ids)
      } else {
        throw new Error("ORDER module draft order delete API not available")
      }
    }
  })

  await step("Soft delete orders (module)", async () => {
    if (!catalog.orders.length) return
    const orderModule: any = container.resolve(Modules.ORDER)
    for (const ids of chunk(catalog.orders)) {
      if (typeof orderModule.softDeleteOrders === "function") {
        await orderModule.softDeleteOrders(ids)
      } else if (typeof orderModule.deleteOrders === "function") {
        await orderModule.deleteOrders(ids)
      } else {
        throw new Error("ORDER module delete API not available")
      }
    }
  })

  await step("Soft delete carts (module)", async () => {
    if (!catalog.carts.length) return
    const cartModule: any = container.resolve(Modules.CART)
    for (const ids of chunk(catalog.carts)) {
      if (typeof cartModule.softDeleteCarts === "function") {
        await cartModule.softDeleteCarts(ids)
      } else if (typeof cartModule.deleteCarts === "function") {
        await cartModule.deleteCarts(ids)
      } else {
        throw new Error("CART module delete API not available")
      }
    }
  })

  // 2) Customer-related
  await step("Unlink and delete customer groups (workflow)", async () => {
    if (!catalog.customerGroups.length) return
    for (const ids of chunk(catalog.customerGroups)) {
      await deleteCustomerGroupsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Soft delete customers (module)", async () => {
    if (!catalog.customers.length) return
    const customerModule: any = container.resolve(Modules.CUSTOMER)
    for (const ids of chunk(catalog.customers)) {
      if (typeof customerModule.softDeleteCustomers === "function") {
        await customerModule.softDeleteCustomers(ids)
      } else if (typeof customerModule.deleteCustomers === "function") {
        await customerModule.deleteCustomers(ids)
      } else {
        throw new Error("CUSTOMER module delete API not available")
      }
    }
  })

  // 3) Fulfillment/shipping/inventory
  await step("Delete shipping options (workflow)", async () => {
    if (!catalog.shippingOptions.length) return
    for (const ids of chunk(catalog.shippingOptions)) {
      await deleteShippingOptionsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Soft delete fulfillment sets (module)", async () => {
    if (!catalog.fulfillmentSets.length) return
    const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
    for (const ids of chunk(catalog.fulfillmentSets)) {
      if (typeof fulfillmentModule.softDeleteFulfillmentSets === "function") {
        await fulfillmentModule.softDeleteFulfillmentSets(ids)
      } else if (typeof fulfillmentModule.deleteFulfillmentSets === "function") {
        await fulfillmentModule.deleteFulfillmentSets(ids)
      } else {
        // Not critical; continue
        throw new Error("FULFILLMENT module delete API not available")
      }
    }
  })

  await step("Delete stock locations (workflow)", async () => {
    if (!catalog.stockLocations.length) return
    for (const ids of chunk(catalog.stockLocations)) {
      await deleteStockLocationsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Soft delete inventory items (module)", async () => {
    if (!catalog.inventoryItems.length) return
    const inventoryModule: any = container.resolve(Modules.INVENTORY)
    for (const ids of chunk(catalog.inventoryItems)) {
      if (typeof inventoryModule.softDeleteInventoryItems === "function") {
        await inventoryModule.softDeleteInventoryItems(ids)
      } else if (typeof inventoryModule.deleteInventoryItems === "function") {
        await inventoryModule.deleteInventoryItems(ids)
      } else {
        throw new Error("INVENTORY module delete API not available")
      }
    }
  })

  // 4) Catalog (products, categories, price lists)
  await step("Delete products (workflow)", async () => {
    if (!catalog.products.length) return
    for (const ids of chunk(catalog.products)) {
      await deleteProductsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Delete product categories (workflow)", async () => {
    if (!catalog.productCategories.length) return
    for (const ids of chunk(catalog.productCategories)) {
      await deleteProductCategoriesWorkflow(container).run({ input: ids as any })
    }
  })

  await step("Delete price lists (workflow)", async () => {
    if (!catalog.priceLists.length) return
    for (const ids of chunk(catalog.priceLists)) {
      await deletePriceListsWorkflow(container).run({ input: { ids } })
    }
  })

  // 5) Channels/regions/tax
  await step("Delete sales channels (workflow)", async () => {
    if (!catalog.salesChannels.length) return
    for (const ids of chunk(catalog.salesChannels)) {
      await deleteSalesChannelsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Delete tax regions (workflow)", async () => {
    if (!catalog.taxRegions.length) return
    for (const ids of chunk(catalog.taxRegions)) {
      await deleteTaxRegionsWorkflow(container).run({ input: { ids } })
    }
  })

  await step("Delete regions (workflow)", async () => {
    if (!catalog.regions.length) return
    for (const ids of chunk(catalog.regions)) {
      await deleteRegionsWorkflow(container).run({ input: { ids } })
    }
  })

  // 6) API keys
  await step("Delete API keys (workflow)", async () => {
    if (!catalog.apiKeys.length) return
    for (const ids of chunk(catalog.apiKeys)) {
      await deleteApiKeysWorkflow(container).run({ input: { ids } })
    }
  })

  // 7) Optional: Users and Store
  if (!flags.preserveUsers) {
    await step("Soft delete users (module)", async () => {
      if (!catalog.users.length) return
      const userModule: any = container.resolve("user")
      for (const ids of chunk(catalog.users)) {
        if (typeof userModule.softDeleteUsers === "function") {
          await userModule.softDeleteUsers(ids)
        } else if (typeof userModule.deleteUsers === "function") {
          await userModule.deleteUsers(ids)
        } else {
          throw new Error("USER module delete API not available")
        }
      }
    })
  } else {
    logger.info("Preserving users as requested")
  }

  if (!flags.preserveStore) {
    await step("Soft delete stores (module)", async () => {
      if (!catalog.stores.length) return
      const storeModule: any = container.resolve(Modules.STORE)
      for (const ids of chunk(catalog.stores)) {
        if (typeof storeModule.softDeleteStores === "function") {
          await storeModule.softDeleteStores(ids)
        } else if (typeof storeModule.deleteStores === "function") {
          await storeModule.deleteStores(ids)
        } else {
          throw new Error("STORE module delete API not available")
        }
      }
    })
  } else {
    logger.info("Preserving stores as requested")
  }

  logger.info("Nuke script finished.")
}
