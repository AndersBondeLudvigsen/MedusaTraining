import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createAndCompleteReturnOrderWorkflow } from "@medusajs/core-flows";

type OrderItem = { id: string; quantity?: number; fulfilled_quantity?: number };

export default async function createReturnsForFirstThree({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // Paste your order ID here
  const ORDER_ID = "order_01K4SC5B4PAB7DCG8T0C6CF6W1";

  if (!ORDER_ID) {
    logger.warn(
      "Please set ORDER_ID in src/scripts/create-returns-first-three.ts before running this script."
    );
    return;
  }

  logger.info(`🧾 Creating a return for order ${ORDER_ID}…`);

  // 1) Load order details (id, display_id, items)
  const { data: orders } = (await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "region_id",
      "items.*",
    ],
    filters: { id: ORDER_ID },
  })) as any;

  const order = orders?.[0];
  if (!order) {
    logger.error(`❌ Order ${ORDER_ID} not found.`);
    return;
  }

  const items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
  if (!items.length) {
    logger.warn(`⚠️ Order ${order.display_id ?? order.id}: no items to return.`);
    return;
  }

  // 2) Build return items: return min(1, fulfilled) for each item
  const returnItems = items
    .filter((it: any) => !!it?.id)
    .map((it: any) => {
      const orderedRaw =
        it?.quantity ?? it?.detail?.quantity ?? it?.original_quantity ?? 0;
      const ordered = Number(orderedRaw) || 0;

      const fulfilledRaw =
        it?.detail?.fulfilled_quantity ?? it?.fulfilled_quantity ?? undefined;
      const fulfilled =
        fulfilledRaw === undefined ? undefined : Number(fulfilledRaw) || 0;

      const desired =
        fulfilled !== undefined
          ? Math.min(ordered, Math.max(0, fulfilled))
          : Math.min(1, ordered);

      const quantity = Math.max(0, desired);
      return { id: String(it.id), quantity };
    })
    .filter((it) => it.quantity > 0);

  if (!returnItems.length) {
    logger.warn(
      `⚠️ Order ${order.display_id ?? order.id}: no returnable quantity found.`
    );
    return;
  }

  // 3) Pick a return shipping option: prefer "Standard Shipping", else first available
  const { data: shippingOptions } = (await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "price_type",
      "provider_id",
      "type.code",
      "service_zone_id",
    ],
  })) as { data: Array<{ id: string; name?: string }> };

  if (!shippingOptions?.length) {
    logger.error(
      "❌ No shipping options found. Create at least one shipping option first."
    );
    return;
  }

  const standard = shippingOptions.find(
    (o) => (o.name || "").toLowerCase().includes("standard")
  );
  const chosenOption = standard || shippingOptions[0];

  logger.info(
    `🚚 Using return shipping option: ${chosenOption.name || chosenOption.id}`
  );

  // 4) Create and complete the return with shipping
  try {
    const { result } = await createAndCompleteReturnOrderWorkflow(container).run({
      input: {
        order_id: order.id,
        items: returnItems,
        return_shipping: {
          option_id: chosenOption.id,
        },
        // You can set receive_now to true to auto-receive returned items
        receive_now: false,
      },
    });

    logger.info(
      `✅ Return created for order ${order.display_id ?? order.id}: ${result?.id}`
    );
  } catch (e: any) {
    logger.error(
      `❌ Failed to create return for order ${order.display_id ?? order.id}: ${
        e?.message || e
      }`
    );
  }
}
