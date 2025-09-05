import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  getOrderDetailWorkflow,
  createOrderFulfillmentWorkflow,
} from "@medusajs/core-flows";

export default async function fulfillAllOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  logger.info("🚀 Starting order fulfillment process...");

  // Get all orders
  const { data: allOrders } = (await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "total",
      "currency_code",
      "email",
      "customer.first_name",
      "customer.last_name",
    ],
  })) as any;

  if (!allOrders.length) {
    logger.info("✅ No orders found in the system.");
    return;
  }

  logger.info(
    `📦 Found ${allOrders.length} orders in the system. Checking payment and fulfillment status...`
  );
  logger.info(
    `📦 Found ${allOrders.length} orders in the system. Checking payment and fulfillment status...`
  );

  // Process each order to check its detailed status
  const ordersToProcess: any[] = [];

  for (const order of allOrders) {
    // Get detailed order information to check payment status
    try {
      const { result: orderDetail } = await getOrderDetailWorkflow(
        container
      ).run({
        input: {
          order_id: order.id,
          fields: ["id", "payment_status", "fulfillment_status"],
        },
      });

      if ((orderDetail as any).payment_status === "captured") {
        ordersToProcess.push(order);
      }
    } catch (error) {
      logger.warn(`Could not get details for order ${order.id}: ${error}`);
    }
  }

  if (!ordersToProcess.length) {
    logger.info("✅ No paid orders found that need fulfillment.");
    return;
  }

  logger.info(`🎯 Found ${ordersToProcess.length} paid orders to process:`);

  // Log order details before processing
  ordersToProcess.forEach((order) => {
    const customerName = order.customer
      ? `${order.customer.first_name || ""} ${
          order.customer.last_name || ""
        }`.trim()
      : "Guest";
    logger.info(
      `  • Order #${order.display_id} (${order.id}) - ${customerName} - ${
        order.email
      } - ${(order.total / 100).toFixed(
        2
      )} ${order.currency_code.toUpperCase()} - Status: ${order.status}`
    );
  });

  let successCount = 0;
  let errorCount = 0;
  let alreadyFulfilledCount = 0;

  // Process each order
  for (const order of ordersToProcess) {
    try {
      logger.info(
        `\n🔄 Processing Order #${order.display_id} (${order.id})...`
      );

      // Get detailed order information including items
      const { result: orderDetail } = await getOrderDetailWorkflow(
        container
      ).run({
        input: {
          order_id: order.id,
          fields: [
            "id",
            "display_id",
            "status",
            "total",
            "payment_status",
            "fulfillment_status",
            "items.id",
            "items.title",
            "items.quantity",
            "items.raw_quantity",
            "items.fulfilled_total",
            "items.variant_title",
            "items.variant_sku",
            "fulfillments.id",
            "fulfillments.packed_at",
            "fulfillments.shipped_at",
          ],
        },
      });

      logger.info(`  📋 Order Details:`);
      logger.info(
        `    Total: ${((orderDetail.total as number) / 100).toFixed(
          2
        )} ${order.currency_code.toUpperCase()}`
      );
      logger.info(`    Status: ${orderDetail.status}`);
      logger.info(
        `    Payment Status: ${
          (orderDetail as any).payment_status || "unknown"
        }`
      );
      logger.info(
        `    Fulfillment Status: ${
          (orderDetail as any).fulfillment_status || "unknown"
        }`
      );
      logger.info(
        `    Existing fulfillments: ${
          ((orderDetail.fulfillments as any[]) || []).length
        }`
      );
      logger.info(`    Items:`);

      if (!orderDetail.items || orderDetail.items.length === 0) {
        logger.warn(
          `    ⚠️  No items found in order #${order.display_id}. Skipping.`
        );
        continue;
      }

      // Display items before fulfillment
      const itemsNeedingFulfillment: Array<{
        id: string;
        quantity: number;
        title: string;
        variant?: any;
      }> = [];

      (orderDetail.items as any[]).forEach((item: any) => {
        // Check multiple possible quantity fields
        const orderedQuantity = item.quantity || item.raw_quantity?.value || 0;
        const fulfilledQuantity =
          item.fulfilled_quantity ||
          (item.fulfilled_total > 0 ? orderedQuantity : 0) ||
          0;
        const remainingQuantity = orderedQuantity - fulfilledQuantity;

        logger.info(
          `      - ${item.title} ${
            item.variant_title ? `(${item.variant_title})` : ""
          } ${item.variant_sku ? `[SKU: ${item.variant_sku}]` : ""}`
        );
        logger.info(
          `        Ordered: ${orderedQuantity}, Fulfilled: ${fulfilledQuantity}, Remaining: ${remainingQuantity}`
        );
        logger.info(
          `        Item details: quantity=${
            item.quantity
          }, raw_quantity=${JSON.stringify(
            item.raw_quantity
          )}, fulfilled_total=${item.fulfilled_total}`
        );

        if (remainingQuantity > 0) {
          itemsNeedingFulfillment.push({
            id: item.id,
            quantity: remainingQuantity,
            title: item.title,
            variant: { title: item.variant_title, sku: item.variant_sku },
          });
        }
      });

      if (itemsNeedingFulfillment.length === 0) {
        logger.info(
          `  ✅ All items in order #${order.display_id} are already fulfilled.`
        );
        alreadyFulfilledCount++;
        continue;
      }

      logger.info(`  🎯 Items to fulfill:`);
      itemsNeedingFulfillment.forEach((item) => {
        logger.info(
          `    - ${item.title} ${
            item.variant?.title ? `(${item.variant.title})` : ""
          } x${item.quantity}`
        );
      });

      // Create fulfillment (this will automatically allocate inventory and create the fulfillment)
      logger.info(`  🔄 Creating fulfillment and allocating inventory...`);
      logger.info(
        `    📦 Step 1: Reserving inventory for ${itemsNeedingFulfillment.length} item(s)...`
      );

      const fulfillmentItems = itemsNeedingFulfillment.map((item) => ({
        id: item.id,
        quantity: item.quantity,
      }));

      logger.info(`    📋 Fulfillment items prepared:`);
      fulfillmentItems.forEach((item, index) => {
        const originalItem = itemsNeedingFulfillment[index];
        logger.info(
          `      - Item ID: ${item.id}, Quantity: ${item.quantity} (${originalItem.title})`
        );
      });

      logger.info(`    🚛 Step 2: Creating fulfillment workflow...`);

      await createOrderFulfillmentWorkflow(container).run({
        input: {
          order_id: order.id,
          items: fulfillmentItems,
        },
      });

      logger.info(`  ✅ Successfully fulfilled order #${order.display_id}!`);
      logger.info(`    ✨ What happened:`);
      logger.info(
        `      1. ✅ Inventory automatically allocated for ${fulfillmentItems.length} item(s)`
      );
      logger.info(
        `      2. ✅ Inventory reservations created to prevent overselling`
      );
      logger.info(
        `      3. ✅ Fulfillment record created and ready for shipping`
      );
      logger.info(`      4. ✅ Order status updated to reflect fulfillment`);

      successCount++;
    } catch (error: any) {
      logger.error(
        `  ❌ Failed to fulfill order #${order.display_id}: ${error.message}`
      );
      logger.error(`    Error details: ${error.stack || error}`);

      // Provide more specific error guidance
      if (error.message.includes("inventory")) {
        logger.error(
          `    💡 This may be an inventory issue - check stock levels`
        );
      } else if (error.message.includes("fulfillment")) {
        logger.error(`    💡 This may be a fulfillment configuration issue`);
      }

      errorCount++;
    }
  }

  // Summary
  logger.info(`\n🎉 Fulfillment process completed!`);
  logger.info(`  ✅ Successfully fulfilled: ${successCount} orders`);
  logger.info(`  ℹ️  Already fulfilled: ${alreadyFulfilledCount} orders`);
  if (errorCount > 0) {
    logger.error(`  ❌ Failed to fulfill: ${errorCount} orders`);
  }
  logger.info(
    `  📊 Total processed: ${
      successCount + errorCount + alreadyFulfilledCount
    } orders`
  );

  if (successCount > 0) {
    logger.info(`\n💡 Next steps:`);
    logger.info(`  1. 📧 Check your fulfillment provider for shipping labels`);
    logger.info(`  2. 📦 Update tracking information when items are shipped`);
    logger.info(`  3. 📊 Monitor inventory levels for restocking needs`);
    logger.info(
      `  4. 🔄 Run this script again if you have more orders to fulfill`
    );
  }

  if (errorCount === 0 && successCount === 0 && alreadyFulfilledCount > 0) {
    logger.info(`\n💡 All orders are already fulfilled! 🎉`);
  }
}
