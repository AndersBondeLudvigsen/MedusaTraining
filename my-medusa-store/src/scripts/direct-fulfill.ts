import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createOrderFulfillmentWorkflow,
} from "@medusajs/core-flows";

export default async function fulfillOrderDirect({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  
  // Specific order ID to test with
  const orderId = "order_01K4C72SVZ0PT1SBNHDQ9AZCXX"; // Order #407
  
  logger.info(`🚀 Direct fulfillment test for order: ${orderId}`);

  try {
    // Get order using query.graph directly
    logger.info(`📋 Fetching order with query.graph...`);
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "payment_status",
        "fulfillment_status", 
        "total",
        "currency_code",
        "items.id",
        "items.title",
        "items.quantity",
        "items.variant_title",
        "items.variant_sku",
        "items.fulfilled_quantity",
        "fulfillments.id",
      ],
      filters: { id: orderId },
    }) as any;

    if (!orders || orders.length === 0) {
      logger.error(`❌ Order not found: ${orderId}`);
      return;
    }

    const order = orders[0];
    logger.info(`📊 Order found:`);
    logger.info(`  ID: ${order.id}`);
    logger.info(`  Display ID: ${order.display_id}`);
    logger.info(`  Status: ${order.status}`);
    logger.info(`  Payment Status: ${order.payment_status}`);
    logger.info(`  Fulfillment Status: ${order.fulfillment_status}`);
    logger.info(`  Total: ${((order.total || 0) / 100).toFixed(2)} ${order.currency_code.toUpperCase()}`);
    logger.info(`  Fulfillments: ${(order.fulfillments || []).length}`);

    if (!order.items || order.items.length === 0) {
      logger.error(`❌ No items found in order!`);
      return;
    }

    logger.info(`📦 Items (${order.items.length}):`);
    const itemsToFulfill: any[] = [];

    order.items.forEach((item: any, index: number) => {
      logger.info(`  Item ${index + 1}:`);
      logger.info(`    🆔 ID: ${item.id}`);
      logger.info(`    📦 Title: ${item.title}`);
      logger.info(`    🏷️ Variant: ${item.variant_title || 'N/A'}`);
      logger.info(`    🔢 SKU: ${item.variant_sku || 'N/A'}`);
      logger.info(`    📊 Quantity: ${item.quantity}`);
      logger.info(`    ✅ Fulfilled Quantity: ${item.fulfilled_quantity || 0}`);
      
      const quantity = item.quantity || 0;
      const fulfilledQuantity = item.fulfilled_quantity || 0;
      const remainingQuantity = quantity - fulfilledQuantity;

      logger.info(`    🎯 Remaining to fulfill: ${remainingQuantity}`);

      if (remainingQuantity > 0) {
        logger.info(`    ➕ Adding to fulfillment queue`);
        itemsToFulfill.push({
          id: item.id,
          quantity: remainingQuantity
        });
      } else {
        logger.info(`    ⏭️ Already fulfilled or no quantity`);
      }
    });

    if (itemsToFulfill.length === 0) {
      logger.info(`✅ No items need fulfillment.`);
      return;
    }

    // Check payment status
    if (order.payment_status !== "captured") {
      logger.error(`❌ Order payment status is '${order.payment_status}' - only captured orders can be fulfilled.`);
      return;
    }

    logger.info(`💳 Payment verified: ${order.payment_status}`);
    logger.info(`🚛 Preparing to fulfill ${itemsToFulfill.length} item type(s):`);
    
    itemsToFulfill.forEach((item, index) => {
      logger.info(`  ${index + 1}. Item ID: ${item.id}, Quantity: ${item.quantity}`);
    });

    logger.info(`🔄 Creating fulfillment workflow...`);
    logger.info(`📋 Input data: ${JSON.stringify({ order_id: orderId, items: itemsToFulfill }, null, 2)}`);

    const fulfillmentResult = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: orderId,
        items: itemsToFulfill,
      },
    });

    logger.info(`🎉 SUCCESS! Fulfillment workflow completed!`);
    logger.info(`📝 Result: ${JSON.stringify(fulfillmentResult, null, 2)}`);
    
    // Verify by re-fetching the order
    logger.info(`🔍 Verifying results by re-fetching order...`);
    const { data: updatedOrders } = await query.graph({
      entity: "order", 
      fields: [
        "id",
        "fulfillment_status",
        "items.fulfilled_quantity",
        "fulfillments.id",
      ],
      filters: { id: orderId },
    }) as any;

    if (updatedOrders && updatedOrders.length > 0) {
      const updatedOrder = updatedOrders[0];
      logger.info(`📊 Updated Status:`);
      logger.info(`  Fulfillment Status: ${updatedOrder.fulfillment_status}`);
      logger.info(`  Fulfillments: ${(updatedOrder.fulfillments || []).length}`);
      
      if (updatedOrder.items) {
        updatedOrder.items.forEach((item: any, index: number) => {
          logger.info(`  Item ${index + 1} fulfilled qty: ${item.fulfilled_quantity || 0}`);
        });
      }
    }

  } catch (error: any) {
    logger.error(`❌ Error: ${error.message}`);
    logger.error(`📜 Stack: ${error.stack}`);
    
    // More specific error handling
    if (error.message.includes("inventory")) {
      logger.error(`💡 Inventory issue - check stock levels and allocations`);
    } else if (error.message.includes("stock")) {
      logger.error(`💡 Stock issue - ensure inventory is available`);
    } else if (error.message.includes("fulfillment")) {
      logger.error(`💡 Fulfillment configuration issue`);
    }
  }
}
