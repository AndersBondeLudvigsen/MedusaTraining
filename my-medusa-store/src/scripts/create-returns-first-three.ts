import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createAndCompleteReturnOrderWorkflow } from "@medusajs/core-flows"; // follow the return end-to-end

type OrderItem = { id: string; quantity?: number; fulfilled_quantity?: number };

// Optional: hardcode a specific order ID to process only that order
// Set to an empty string to fallback to processing the first 3 orders
const HARDCODED_ORDER_ID = "order_01K4SC5B8FCBZGR1W233B57QXH"; // 

export default async function createReturnsForFirstThree({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  if (HARDCODED_ORDER_ID) {
    logger.info(`🧾 Creating return for order ${HARDCODED_ORDER_ID}…`);
  } else {
    logger.info("🧾 Creating returns for the first 3 orders…");
  }

  // 1) Find a stock location to receive returns
  const { data: stockLocations } = (await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })) as { data: Array<{ id: string; name?: string }> };

  if (!stockLocations?.length) {
    logger.error("❌ No stock locations found. Cannot create returns.");
    return;
  }
  const locationId = stockLocations[0].id;

  // 2) Load orders
  let orders: any[] = [];
  if (HARDCODED_ORDER_ID) {
    const { data } = (await query.graph({
      entity: "order",
      fields: ["id", "display_id", "items.*"],
      filters: { id: HARDCODED_ORDER_ID },
    })) as any;
    if (data?.length) {
      orders = [data[0]];
    }
  } else {
    const { data: allOrders } = (await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        // Fetch full item shape to account for different schemas
        "items.*",
      ],
    })) as any;
    orders = (allOrders || []).slice(0, 3);
  }

  if (!orders.length) {
    logger.info("ℹ️ No orders found—nothing to return.");
    return;
  }

  logger.info(`📦 Will create returns for ${orders.length} order(s).`);

  // 2.5) Load shipping options and pick a default to be used for returns
  // Preference: name contains "Standard", else take index 0
  let { data: shippingOptions } = (await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  })) as { data: Array<{ id: string; name?: string }> };
  shippingOptions = shippingOptions || [];
  const chosenShippingOptionId =
    shippingOptions.find((s) => /standard/i.test(s?.name || ""))?.id ||
    shippingOptions[0]?.id;
  if (!chosenShippingOptionId) {
    logger.error(
      "❌ No shipping options found. A return shipping option is required to complete returns."
    );
    return;
  }

  // Helper: end-to-end return using createAndCompleteReturnOrderWorkflow
  // This will: create the return, create a return fulfillment with the chosen
  // shipping option, and mark as received if receive_now = true.
  async function createReturnForOrder(input: {
    order_id: string;
    items: Array<{ id: string; quantity: number; reason_id?: string; note?: string }>;
    location_id?: string;
    internal_note?: string;
  }): Promise<{ id?: string } | void> {
    const { result } = await createAndCompleteReturnOrderWorkflow(container).run({
      input: {
        order_id: input.order_id,
        items: input.items.map((i) => ({ id: i.id, quantity: i.quantity })),
        return_shipping: {
          option_id: chosenShippingOptionId,
        },
        // Create + confirm + add return shipping (no auto-receive by default)
        receive_now: false,
        // If provided, overrides shipping option's stock location
        location_id: input.location_id,
        note: input.internal_note,
      },
    });
    return { id: (result as any)?.id };
  }

  let success = 0;
  for (const order of orders) {
    const orderId: string | undefined = order?.id;
    const display = order?.display_id ?? orderId?.slice(0, 8);
    if (!orderId) {
      logger.warn("⚠️ Skipping an order without ID.");
      continue;
    }

    const items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    if (!items.length) {
      logger.warn(`⚠️ Order ${display}: no items to return. Skipping.`);
      continue;
    }

    // Strategy: return 1 unit for each item (safer), capped by fulfilled qty if present
    const returnItems = items
      .filter((it) => !!(it as any)?.id)
      .map((it: any) => {
        // Support both top-level and nested detail fields across Medusa versions
        const orderedRaw =
          it?.quantity ?? it?.detail?.quantity ?? it?.original_quantity ?? 0;
        const ordered = Number(orderedRaw) || 0;

        const fulfilledRaw =
          it?.detail?.fulfilled_quantity ?? it?.fulfilled_quantity ?? undefined;
        const fulfilled =
          fulfilledRaw === undefined ? undefined : Number(fulfilledRaw) || 0;

        // If fulfilled known, return up to that; otherwise fall back to 1 (if ordered > 0)
        const desired =
          fulfilled !== undefined
            ? Math.min(ordered, Math.max(0, fulfilled))
            : Math.min(1, ordered);

        const quantity = Math.max(0, desired);
        return { id: String(it.id), quantity };
      })
      .filter((it) => it.quantity > 0);

    if (!returnItems.length) {
      logger.warn(`⚠️ Order ${display}: no returnable quantity. Skipping.`);
      continue;
    }

    logger.info(
      `↩️ Creating return for order ${display} with ${returnItems.length} item(s)…`
    );
    try {
      const created = await createReturnForOrder({
        order_id: orderId,
        items: returnItems,
        location_id: locationId,
        internal_note: "Automated return created by script",
      });
      const rid = (created as any)?.id ?? "(id unknown)";
      logger.info(`✅ Return created for order ${display}: ${rid}`);
      success++;
    } catch (e: any) {
      logger.error(
        `❌ Failed to create return for order ${display}: ${e?.message || e}`
      );
    }
  }

  logger.info(`\n📈 Done. Created ${success} return(s).`);
}
