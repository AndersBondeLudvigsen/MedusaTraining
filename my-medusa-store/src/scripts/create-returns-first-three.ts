import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  beginReturnOrderWorkflow,
  requestItemReturnWorkflow,
  confirmReturnRequestWorkflow,
  // createAndCompleteReturnOrderWorkflow, // available but requires a return shipping option
} from "@medusajs/core-flows";

type OrderItem = { id: string; quantity?: number; fulfilled_quantity?: number };

export default async function createReturnsForFirstThree({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  logger.info("🧾 Creating returns for the first 3 orders…");

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

  // 2) Load orders (take first 3)
  const { data: allOrders } = (await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      // Fetch full item shape to account for different schemas
      "items.*",
    ],
    // Some setups support ordering and take; keep simple and slice later
  })) as any;

  const orders = (allOrders || []).slice(0, 3);

  if (!orders.length) {
    logger.info("ℹ️ No orders found—nothing to return.");
    return;
  }

  logger.info(`📦 Will create returns for ${orders.length} order(s).`);

  // Helper: best-effort call into available return creation workflow/module
  async function createReturnForOrder(input: {
    order_id: string;
    items: Array<{ id: string; quantity: number; reason_id?: string; note?: string }>;
    location_id: string;
    internal_note?: string;
  }): Promise<{ id?: string } | void> {
    // Preferred Medusa v2 path: use order return workflows in core-flows.
    // We avoid requiring a return shipping option by using the 3-step flow:
    // 1) beginReturnOrderWorkflow -> 2) requestItemReturnWorkflow -> 3) confirmReturnRequestWorkflow
    // This results in a requested return without creating a return fulfillment.
    
    // 1) Begin return (creates a return + order change)
    const begin = await beginReturnOrderWorkflow(container).run({
      input: {
        order_id: input.order_id,
        location_id: input.location_id,
        internal_note: input.internal_note,
      },
    });
    const orderChange = (begin as any)?.result ?? begin;

    // 2) Determine return_id either from the workflow result or by re-querying the order_change
    let returnId: string | undefined = orderChange?.return_id;
    if (!returnId) {
      const re = (await query.graph({
        entity: "order_change",
        fields: ["id", "return_id", "order_id"],
        filters: { id: orderChange?.id },
      })) as { data: Array<{ id: string; return_id?: string }> };
      returnId = re?.data?.[0]?.return_id;
    }
    if (!returnId) {
      throw new Error("Could not resolve return_id from beginReturnOrderWorkflow result");
    }

    // 3) Add items to the return
    await requestItemReturnWorkflow(container).run({
      input: {
        return_id: returnId,
        items: input.items.map((i) => ({ id: i.id, quantity: i.quantity })),
      },
    });

    // 4) Confirm the return request (does not require a shipping method)
    await confirmReturnRequestWorkflow(container).run({
      input: { return_id: returnId },
    });

    return { id: returnId };
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
