import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
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
} from "@medusajs/medusa/core-flows";

type Flags = {
  force: boolean;
  dryRun: boolean;
  preserveStore: boolean;
  preserveUsers: boolean;
  preserveAdmins: boolean;
};

function parseFlags(argv: string[]): Flags {
  const args = new Set(argv.slice(2));
  const force = !!process.env.NUKE_ALL || args.has("--force") || args.has("-f");
  return {
    force,
    // Support env vars since medusa exec may reject unknown CLI args
    dryRun: !!process.env.NUKE_DRY_RUN || args.has("--dry-run"),
    preserveStore:
      !!process.env.NUKE_PRESERVE_STORE || args.has("--preserve-store"),
    preserveUsers:
      !!process.env.NUKE_PRESERVE_USERS || args.has("--preserve-users"),
    // Convenience alias: admins are represented by the `user` module in Medusa
    preserveAdmins:
      !!process.env.NUKE_PRESERVE_ADMINS || args.has("--preserve-admins"),
  };
}

async function listIds(query: any, entity: string): Promise<string[]> {
  try {
    const { data } = await query.graph({ entity, fields: ["id"], filters: {} });
    const ids = (data || []).map((d: any) => d.id).filter(Boolean);
    console.log(`[nuke] ${entity}: ${ids.length} ids -> ${ids.join(",")}`);
    return ids;
  } catch (e) {
    // Entity not available in this project; treat as empty
    return [];
  }
}

function chunk<T>(arr: T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function nukeAll({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const flags = parseFlags(process.argv);

  logger.info("Nuke script starting…");
  if (!flags.force) {
    logger.error(
      "Refusing to run without confirmation. Re-run with --force or set NUKE_ALL=1."
    );
    logger.info(
      "Optional flags: --dry-run --preserve-store --preserve-users --preserve-admins"
    );
    return;
  }

  const dry = flags.dryRun;
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      if (dry) {
        logger.info(`[dry-run] ${label}`);
        return;
      }
      await fn();
      logger.info(`✔ ${label}`);
    } catch (e: any) {
      logger.warn(`⚠ Skipped ${label}: ${e?.message || String(e)}`);
    }
  };

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
    promotions: await listIds(query, "promotion"),
    campaigns: await listIds(query, "campaign"),
    draftOrders: await listIds(query, "draft_order"),
    orders: await listIds(query, "order"),
    customers: await listIds(query, "customer"),
    carts: await listIds(query, "cart"),
    users: await listIds(query, "user"),
    stores: await listIds(query, "store"),
  };

  logger.info(
    `Summary before deletion: ` +
      Object.entries(catalog)
        .map(([k, v]) => `${k}=${(v as string[]).length}`)
        .join(", ")
  );

  // 1) Orders and carts first (to free ties to items, inventory, etc.)
  await step("Soft delete draft orders (module)", async () => {
    if (!catalog.draftOrders.length) return;
    const orderModule: any = container.resolve(Modules.ORDER);
    for (const ids of chunk(catalog.draftOrders)) {
      if (typeof orderModule.softDeleteDraftOrders === "function") {
        await orderModule.softDeleteDraftOrders(ids);
      } else if (typeof orderModule.deleteDraftOrders === "function") {
        await orderModule.deleteDraftOrders(ids);
      } else {
        throw new Error("ORDER module draft order delete API not available");
      }
    }
  });

  await step("Soft delete orders (module)", async () => {
    if (!catalog.orders.length) return;
    const orderModule: any = container.resolve(Modules.ORDER);
    for (const ids of chunk(catalog.orders)) {
      if (typeof orderModule.softDeleteOrders === "function") {
        await orderModule.softDeleteOrders(ids);
      } else if (typeof orderModule.deleteOrders === "function") {
        await orderModule.deleteOrders(ids);
      } else {
        throw new Error("ORDER module delete API not available");
      }
    }
  });

  await step("Soft delete carts (module)", async () => {
    if (!catalog.carts.length) return;
    const cartModule: any = container.resolve(Modules.CART);
    for (const ids of chunk(catalog.carts)) {
      if (typeof cartModule.softDeleteCarts === "function") {
        await cartModule.softDeleteCarts(ids);
      } else if (typeof cartModule.deleteCarts === "function") {
        await cartModule.deleteCarts(ids);
      } else {
        throw new Error("CART module delete API not available");
      }
    }
  });

  // 2) Customer-related
  await step("Unlink and delete customer groups (workflow)", async () => {
    if (!catalog.customerGroups.length) return;
    for (const ids of chunk(catalog.customerGroups)) {
      await deleteCustomerGroupsWorkflow(container).run({ input: { ids } });
    }
  });

  // 2.5) Marketing entities (promotions and campaigns)
  await step("Soft delete promotions (module)", async () => {
    if (!catalog.promotions.length) return;
    try {
      const promotionModule: any = container.resolve("promotion");
      for (const ids of chunk(catalog.promotions)) {
        if (typeof promotionModule.softDeletePromotions === "function") {
          await promotionModule.softDeletePromotions(ids);
        } else if (typeof promotionModule.deletePromotions === "function") {
          await promotionModule.deletePromotions(ids);
        } else {
          throw new Error("PROMOTION module delete API not available");
        }
      }
    } catch (e: any) {
      if (e.message?.includes("not registered")) {
        console.log("[nuke] Promotion module not available, skipping...");
      } else {
        throw e;
      }
    }
  });

  await step("Soft delete campaigns (promotion module)", async () => {
    if (!catalog.campaigns.length) return;
    try {
      // Try promotion module first since campaigns are often managed there
      const promotionModule: any = container.resolve("promotion");
      for (const ids of chunk(catalog.campaigns)) {
        if (typeof promotionModule.softDeleteCampaigns === "function") {
          await promotionModule.softDeleteCampaigns(ids);
        } else if (typeof promotionModule.deleteCampaigns === "function") {
          await promotionModule.deleteCampaigns(ids);
        } else {
          throw new Error(
            "Campaign delete API not available in promotion module"
          );
        }
      }
    } catch (e: any) {
      console.log(
        "[nuke] Could not delete campaigns via promotion module:",
        e.message
      );

      // Fallback 1: try standalone campaign module
      try {
        const campaignModule: any = container.resolve("campaign");
        for (const ids of chunk(catalog.campaigns)) {
          if (typeof campaignModule.softDeleteCampaigns === "function") {
            await campaignModule.softDeleteCampaigns(ids);
          } else if (typeof campaignModule.deleteCampaigns === "function") {
            await campaignModule.deleteCampaigns(ids);
          } else {
            throw new Error("CAMPAIGN module delete API not available");
          }
        }
      } catch (e2: any) {
        console.log(
          "[nuke] Could not delete campaigns via campaign module:",
          e2.message
        );

        // Fallback 2: try using entity manager for direct deletion
        try {
          const manager: any = container.resolve("manager");
          for (const ids of chunk(catalog.campaigns)) {
            // This is a more direct approach but may not trigger proper cleanup
            await manager.delete("Campaign", ids);
          }
          console.log("[nuke] Campaigns deleted via entity manager");
        } catch (e3: any) {
          console.log(
            "[nuke] Could not delete campaigns via entity manager:",
            e3.message
          );
          console.log(
            "[nuke] Campaigns might need manual deletion - consider checking the admin panel"
          );
        }
      }
    }
  });

  await step("Soft delete customers (module)", async () => {
    if (!catalog.customers.length) return;
    const customerModule: any = container.resolve(Modules.CUSTOMER);
    for (const ids of chunk(catalog.customers)) {
      if (typeof customerModule.softDeleteCustomers === "function") {
        await customerModule.softDeleteCustomers(ids);
      } else if (typeof customerModule.deleteCustomers === "function") {
        await customerModule.deleteCustomers(ids);
      } else {
        throw new Error("CUSTOMER module delete API not available");
      }
    }
  });

  // 3) Fulfillment/shipping/inventory
  await step("Delete shipping options (workflow)", async () => {
    if (!catalog.shippingOptions.length) return;
    for (const ids of chunk(catalog.shippingOptions)) {
      await deleteShippingOptionsWorkflow(container).run({ input: { ids } });
    }
  });

  await step("Soft delete fulfillment sets (module)", async () => {
    if (!catalog.fulfillmentSets.length) return;
    const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT);
    for (const ids of chunk(catalog.fulfillmentSets)) {
      if (typeof fulfillmentModule.softDeleteFulfillmentSets === "function") {
        await fulfillmentModule.softDeleteFulfillmentSets(ids);
      } else if (
        typeof fulfillmentModule.deleteFulfillmentSets === "function"
      ) {
        await fulfillmentModule.deleteFulfillmentSets(ids);
      } else {
        // Not critical; continue
        throw new Error("FULFILLMENT module delete API not available");
      }
    }
  });

  await step("Delete stock locations (workflow)", async () => {
    if (!catalog.stockLocations.length) return;
    for (const ids of chunk(catalog.stockLocations)) {
      await deleteStockLocationsWorkflow(container).run({ input: { ids } });
    }
  });

  await step("Soft delete inventory items (module)", async () => {
    if (!catalog.inventoryItems.length) return;
    const inventoryModule: any = container.resolve(Modules.INVENTORY);
    for (const ids of chunk(catalog.inventoryItems)) {
      if (typeof inventoryModule.softDeleteInventoryItems === "function") {
        await inventoryModule.softDeleteInventoryItems(ids);
      } else if (typeof inventoryModule.deleteInventoryItems === "function") {
        await inventoryModule.deleteInventoryItems(ids);
      } else {
        throw new Error("INVENTORY module delete API not available");
      }
    }
  });

  // 4) Catalog (products, categories, price lists)
  await step("Delete products (workflow)", async () => {
    if (!catalog.products.length) return;
    const before = catalog.products.length;
    for (const ids of chunk(catalog.products)) {
      try {
        // Medusa v2.9: expects { ids }
        await deleteProductsWorkflow(container).run({ input: { ids } });
      } catch (e) {
        // Fallback: try module API if workflow signature mismatches
        const productModule: any = container.resolve(Modules.PRODUCT);
        if (typeof productModule.softDeleteProducts === "function") {
          await productModule.softDeleteProducts(ids);
        } else if (typeof productModule.deleteProducts === "function") {
          await productModule.deleteProducts(ids);
        } else {
          throw e;
        }
      }
    }
    // Best-effort visibility: re-query count
    try {
      const remaining = await listIds(query, "product");
      console.log(`[nuke] products before=${before} after=${remaining.length}`);
    } catch {}
  });

  await step("Delete product categories (workflow)", async () => {
    if (!catalog.productCategories.length) return;
    for (const ids of chunk(catalog.productCategories)) {
      await deleteProductCategoriesWorkflow(container).run({
        input: ids as any,
      });
    }
  });

  await step("Delete price lists (workflow)", async () => {
    if (!catalog.priceLists.length) return;
    for (const ids of chunk(catalog.priceLists)) {
      await deletePriceListsWorkflow(container).run({ input: { ids } });
    }
  });

  // 5) Channels/regions/tax
  await step("Delete sales channels (workflow)", async () => {
    if (!catalog.salesChannels.length) return;
    for (const ids of chunk(catalog.salesChannels)) {
      await deleteSalesChannelsWorkflow(container).run({ input: { ids } });
    }
  });

  await step("Delete tax regions (workflow)", async () => {
    if (!catalog.taxRegions.length) return;
    for (const ids of chunk(catalog.taxRegions)) {
      await deleteTaxRegionsWorkflow(container).run({ input: { ids } });
    }
  });

  await step("Delete regions (workflow)", async () => {
    if (!catalog.regions.length) return;
    for (const ids of chunk(catalog.regions)) {
      await deleteRegionsWorkflow(container).run({ input: { ids } });
    }
  });

  // 6) API keys
  await step("Delete API keys (workflow)", async () => {
    if (!catalog.apiKeys.length) return;
    for (const ids of chunk(catalog.apiKeys)) {
      await deleteApiKeysWorkflow(container).run({ input: { ids } });
    }
  });

  // 7) Optional: Users and Store
  if (!(flags.preserveUsers || flags.preserveAdmins)) {
    await step("Soft delete users (module)", async () => {
      if (!catalog.users.length) return;
      const userModule: any = container.resolve("user");
      for (const ids of chunk(catalog.users)) {
        if (typeof userModule.softDeleteUsers === "function") {
          await userModule.softDeleteUsers(ids);
        } else if (typeof userModule.deleteUsers === "function") {
          await userModule.deleteUsers(ids);
        } else {
          throw new Error("USER module delete API not available");
        }
      }
    });
  } else {
    logger.info("Preserving users/admins as requested");
  }

  if (!flags.preserveStore) {
    await step("Soft delete stores (module)", async () => {
      if (!catalog.stores.length) return;
      const storeModule: any = container.resolve(Modules.STORE);
      for (const ids of chunk(catalog.stores)) {
        if (typeof storeModule.softDeleteStores === "function") {
          await storeModule.softDeleteStores(ids);
        } else if (typeof storeModule.deleteStores === "function") {
          await storeModule.deleteStores(ids);
        } else {
          throw new Error("STORE module delete API not available");
        }
      }
    });
  } else {
    logger.info("Preserving stores as requested");
  }

  logger.info("Nuke script finished.");
}
