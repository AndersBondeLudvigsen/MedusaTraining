import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createAndCompleteReturnOrderWorkflow,
  receiveAndCompleteReturnOrderWorkflow,
  refundPaymentsWorkflow,
  getOrderDetailWorkflow,
} from "@medusajs/core-flows";

type OrderItem = { id: string; quantity?: number; fulfilled_quantity?: number };

export default async function createReturnsForFirstThree({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // Paste your order ID here
  const ORDER_ID = "order_01K4SEVRT2P546ET9MDPEGX1SF";

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

    const createdReturnId = result?.id as string | undefined;
    if (!createdReturnId) {
      logger.warn(
        `⚠️ Return created but ID not returned. Attempting to locate by order.`
      );
    }

    // 5) Re-fetch the return to get items and refund amount
    const { data: foundReturns } = (await query.graph({
      entity: "return",
      fields: [
        "id",
        "status",
        "refund_amount",
        "items.id",
        "items.item_id",
        "items.quantity",
      ],
      filters: createdReturnId ? { id: createdReturnId } : { order_id: order.id },
    })) as any;

    const createdReturn = foundReturns?.[0];
    if (!createdReturn) {
      logger.error("❌ Could not retrieve created return details.");
      return;
    }

    logger.info(
      `✅ Return created for order ${order.display_id ?? order.id}: ${createdReturn.id}`
    );

    // 6) Receive the returned items (marks return as received)
    const itemsToReceive = (createdReturn.items || [])
      .filter((ri: any) => !!ri?.item_id && !!ri?.quantity)
      .map((ri: any) => ({ id: String(ri.item_id), quantity: Number(ri.quantity) }));

    if (itemsToReceive.length) {
      await receiveAndCompleteReturnOrderWorkflow(container).run({
        input: {
          return_id: createdReturn.id,
          items: itemsToReceive,
        },
      });
      logger.info(`📦 Marked return ${createdReturn.id} as received.`);
    } else {
      logger.warn(
        `⚠️ Return ${createdReturn.id} has no items to receive. Skipping receival.`
      );
    }

    // 7) Determine refund amount
    let refundAmount = Number(createdReturn.refund_amount ?? 0);

    if (!refundAmount || isNaN(refundAmount)) {
      // Fallback: compute from order's refundable per-unit totals
      const { result: detail } = await getOrderDetailWorkflow(container).run({
        input: {
          order_id: order.id,
          fields: [
            "id",
            "currency_code",
            "items.id",
            "items.refundable_total_per_unit",
            "payment_collections.id",
            "payment_collections.payments.id",
            "payment_collections.payments.captures.amount",
            "payment_collections.payments.refunds.amount",
          ],
        },
      });
      const itemMap: Record<string, number> = {};
      for (const it of detail.items || []) {
        itemMap[it.id] = Number(it.refundable_total_per_unit ?? 0) || 0;
      }
      refundAmount = (createdReturn.items || []).reduce(
        (sum: number, ri: any) => sum + (itemMap[ri.item_id] || 0) * Number(ri.quantity || 0),
        0
      );
    }

    if (!refundAmount || refundAmount <= 0) {
      logger.warn(
        `⚠️ Computed refund amount is 0 for return ${createdReturn.id}. Skipping refund.`
      );
      return;
    }

    // 8) Refund captured payments up to the refund amount
    const { result: orderDetail } = await getOrderDetailWorkflow(container).run({
      input: {
        order_id: order.id,
        fields: [
          "id",
          "payment_collections.payments.id",
          "payment_collections.payments.captures.amount",
          "payment_collections.payments.refunds.amount",
        ],
      },
    });

    const payments: any[] = (orderDetail.payment_collections || [])
      .flatMap((pc: any) => pc.payments || [])
      .filter((p: any) => !!p?.id);

    const refundableByPayment = payments.map((p: any) => {
      const captured = (p.captures || []).reduce(
        (acc: number, c: any) => acc + Number(c.amount || 0),
        0
      );
      const refunded = (p.refunds || []).reduce(
        (acc: number, r: any) => acc + Number(r.amount || 0),
        0
      );
      return { id: p.id, refundable: Math.max(0, captured - refunded) };
    });

    let remaining = Math.round(Number(refundAmount));
    const refundInputs: Array<{ payment_id: string; amount: number }> = [];
    for (const p of refundableByPayment) {
      if (remaining <= 0) break;
      if (p.refundable <= 0) continue;
      const amt = Math.min(p.refundable, remaining);
      refundInputs.push({ payment_id: p.id, amount: amt });
      remaining -= amt;
    }

    if (!refundInputs.length) {
      logger.warn(
        `⚠️ No refundable payments found for order ${order.display_id ?? order.id}.`
      );
      return;
    }

    try {
      await refundPaymentsWorkflow(container).run({ input: refundInputs });
      logger.info(
        `💸 Refunded ${refundInputs
          .map((r) => r.amount)
          .reduce((a, b) => a + b, 0)} for order ${order.display_id ?? order.id}.`
      );
    } catch (err: any) {
      logger.error(
        `❌ Failed to refund payments for order ${order.display_id ?? order.id}: ${
          err?.message || err
        }`
      );
    }
  } catch (e: any) {
    logger.error(
      `❌ Failed to create return for order ${order.display_id ?? order.id}: ${
        e?.message || e
      }`
    );
  }
}
