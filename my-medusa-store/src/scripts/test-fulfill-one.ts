import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  getOrderDetailWorkflow,
  createOrderFulfillmentWorkflow,
} from "@medusajs/core-flows";

export default async function fulfillSpecificOrder({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryModuleService = container.resolve(Modules.INVENTORY);
  
  // Specific order ID to test with
  const orderId = "order_01K4C72S9J4GW2NAZEMA4XC08G";
  
  logger.info(`🚀 Testing fulfillment with reservation for order: ${orderId}`);

  try {
    // Step 1: Get order details using query.graph (more reliable)
    logger.info(`📋 Step 1: Fetching order details...`);
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status", 
        "total",
        "currency_code",
        "payment_status",
        "fulfillment_status",
        "items.*", // Get all item fields to see what's available
        "fulfillments.id",
        "payment_collections.status",
        "payment_collections.amount",
      ],
      filters: { id: orderId },
    }) as any;

    if (!orders || orders.length === 0) {
      logger.error(`❌ Order not found: ${orderId}`);
      return;
    }

    const order = orders[0];
    logger.info(`📊 Order Information:`);
    logger.info(`  Order ID: ${order.id}`);
    logger.info(`  Display ID: ${order.display_id}`);
    logger.info(`  Status: ${order.status}`);
    logger.info(`  Payment Status: ${order.payment_status}`);
    logger.info(`  Fulfillment Status: ${order.fulfillment_status}`);
    logger.info(`  Total: ${((order.total || 0) / 100).toFixed(2)} ${order.currency_code?.toUpperCase() || 'EUR'}`);
    logger.info(`  Existing Fulfillments: ${(order.fulfillments || []).length}`);
    logger.info(`  Payment Collections: ${(order.payment_collections || []).length}`);
    
    // Debug: Show all order fields to see what's available
    logger.info(`🔍 DEBUG: Available order fields: ${Object.keys(order).join(', ')}`);
    
    // Check payment status - try multiple ways to get it
    let paymentStatus = order.payment_status;
    if (!paymentStatus && order.payment_collections && order.payment_collections.length > 0) {
      paymentStatus = order.payment_collections[0].status;
      logger.info(`  💳 Payment status from collection: ${paymentStatus}`);
    }
    
    // Check payment status
    if (paymentStatus !== "captured") {
      logger.error(`❌ Order payment status is '${paymentStatus}' - only captured orders can be fulfilled.`);
      logger.info(`💡 If you know the order is paid, we can continue anyway for testing...`);
      // Let's continue anyway for testing since you confirmed it's captured
      logger.info(`🚀 Continuing with fulfillment (payment status override for testing)...`);
    } else {
      logger.info(`✅ Payment status verified: ${paymentStatus}`);
    }

    // Step 2: Check inventory setup
    logger.info(`📦 Step 2: Checking inventory setup...`);
    
    const { data: stockLocations } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
    }) as any;

    if (!stockLocations || stockLocations.length === 0) {
      logger.error(`❌ No stock locations found. You need at least one stock location.`);
      return;
    }

    const stockLocationId = stockLocations[0].id;
    logger.info(`✅ Using stock location: ${stockLocations[0].name} (${stockLocationId})`);

    if (!order.items || order.items.length === 0) {
      logger.error(`❌ No items found in order!`);
      return;
    }

    logger.info(`📦 Items in order (${order.items.length}):`);
    const itemsToFulfill: any[] = [];
    const reservations: any[] = [];
    
    // Debug: Show what fields are available in the first item
    if (order.items && order.items.length > 0) {
      logger.info(`🔍 DEBUG: Available fields in first item: ${Object.keys(order.items[0]).join(', ')}`);
      logger.info(`🔍 DEBUG: First item data: ${JSON.stringify(order.items[0], null, 2)}`);
    }

    // Step 3: Process each item and create reservations
    logger.info(`🔧 Step 3: Processing items and creating reservations...`);

    for (let index = 0; index < order.items.length; index++) {
      const item = order.items[index];
      logger.info(`\n  Item ${index + 1}:`);
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

      if (remainingQuantity <= 0) {
        logger.info(`    ⏭️ Skipping - already fulfilled or no quantity`);
        continue;
      }

      // Find inventory item
      logger.info(`    🔍 Finding inventory item for SKU: ${item.variant_sku}...`);
      const { data: inventoryItems } = await query.graph({
        entity: "inventory_item",
        fields: ["id", "sku"],
        filters: { sku: item.variant_sku },
      }) as any;

      if (!inventoryItems || inventoryItems.length === 0) {
        logger.error(`    ❌ No inventory item found for SKU: ${item.variant_sku}`);
        continue;
      }

      const inventoryItemId = inventoryItems[0].id;
      logger.info(`    ✅ Found inventory item: ${inventoryItemId}`);

      // Check existing reservations
      logger.info(`    🔍 Checking existing reservations...`);
      let reservationExists = false;
      
      try {
        const existingReservations = await inventoryModuleService.listReservationItems({
          line_item_id: item.id,
        });

        if (existingReservations && existingReservations.length > 0) {
          logger.info(`    ✅ Reservation already exists for this item`);
          reservationExists = true;
        }
      } catch (error: any) {
        logger.info(`    ⚠️ Could not check existing reservations: ${error.message}`);
      }

      if (!reservationExists) {
        // Check stock levels before creating reservation
        logger.info(`    📊 Checking stock levels...`);
        try {
          const { data: inventoryLevels } = await query.graph({
            entity: "inventory_level",
            fields: ["stocked_quantity", "reserved_quantity", "available_quantity"],
            filters: { 
              inventory_item_id: inventoryItemId,
              location_id: stockLocationId 
            },
          }) as any;

          if (inventoryLevels && inventoryLevels.length > 0) {
            const level = inventoryLevels[0];
            logger.info(`    📊 Stock status:`);
            logger.info(`      - Stocked: ${level.stocked_quantity}`);
            logger.info(`      - Reserved: ${level.reserved_quantity}`);
            logger.info(`      - Available: ${level.available_quantity}`);
            
            if (level.available_quantity < remainingQuantity) {
              logger.error(`    ❌ Insufficient stock! Need ${remainingQuantity}, have ${level.available_quantity}`);
              continue;
            }
          } else {
            logger.error(`    ❌ No inventory level found for this item at this location`);
            continue;
          }
        } catch (stockError: any) {
          logger.error(`    ❌ Failed to check stock levels: ${stockError.message}`);
          continue;
        }

        // Create reservation
        logger.info(`    🔄 Creating reservation for ${remainingQuantity} units...`);
        try {
          const reservation = await inventoryModuleService.createReservationItems([{
            line_item_id: item.id,
            inventory_item_id: inventoryItemId,
            location_id: stockLocationId,
            quantity: remainingQuantity,
            description: `Reservation for order ${order.display_id} - ${item.title}`,
            metadata: {
              order_id: orderId,
              item_id: item.id,
            },
          }]);

          logger.info(`    ✅ Created reservation: ${reservation[0].id}`);
          reservations.push(reservation[0]);
        } catch (reservationError: any) {
          logger.error(`    ❌ Failed to create reservation: ${reservationError.message}`);
          continue;
        }
      }

      // Add to fulfillment queue
      logger.info(`    ➕ Adding to fulfillment queue`);
      itemsToFulfill.push({
        id: item.id,
        quantity: remainingQuantity
      });
    }

    if (itemsToFulfill.length === 0) {
      logger.info(`❌ No items can be fulfilled (no stock or already fulfilled)`);
      return;
    }

    // Step 4: Create fulfillment
    logger.info(`\n� Step 4: Creating fulfillment for ${itemsToFulfill.length} item(s)...`);
    logger.info(`📋 Items to fulfill:`);
    itemsToFulfill.forEach((item, index) => {
      logger.info(`  ${index + 1}. Item ID: ${item.id}, Quantity: ${item.quantity}`);
    });

    logger.info(`🔄 Creating fulfillment workflow...`);

    const fulfillmentResult = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: orderId,
        items: itemsToFulfill,
      },
    });

    logger.info(`🎉 SUCCESS! Fulfillment created!`);
    logger.info(`📝 Fulfillment ID: ${fulfillmentResult.result?.id || 'Generated'}`);
    
    // Step 5: Verify the fulfillment
    logger.info(`🔍 Step 5: Verifying fulfillment by re-fetching order...`);
    const { data: updatedOrders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "fulfillment_status",
        "items.fulfilled_quantity",
        "fulfillments.id",
        "fulfillments.items.id",
        "fulfillments.items.quantity",
      ],
      filters: { id: orderId },
    }) as any;

    if (updatedOrders && updatedOrders.length > 0) {
      const updatedOrder = updatedOrders[0];
      logger.info(`📊 Updated order status:`);
      logger.info(`  Fulfillment Status: ${updatedOrder.fulfillment_status}`);
      logger.info(`  Total Fulfillments: ${(updatedOrder.fulfillments || []).length}`);
      
      if (updatedOrder.items) {
        updatedOrder.items.forEach((item: any, index: number) => {
          logger.info(`  Item ${index + 1} fulfilled quantity: ${item.fulfilled_quantity || 0}`);
        });
      }

      if (updatedOrder.fulfillments) {
        updatedOrder.fulfillments.forEach((fulfillment: any, index: number) => {
          logger.info(`  Fulfillment ${index + 1}: ${fulfillment.id}`);
          if (fulfillment.items) {
            fulfillment.items.forEach((item: any, itemIndex: number) => {
              logger.info(`    - Item ${itemIndex + 1}: ${item.id} (qty: ${item.quantity})`);
            });
          }
        });
      }
    }

    logger.info(`\n🎉 FULFILLMENT COMPLETE!`);
    logger.info(`✅ What happened:`);
    logger.info(`  1. ✅ Found ${order.items.length} item(s) in the order`);
    logger.info(`  2. ✅ Created ${reservations.length} new inventory reservation(s)`);
    logger.info(`  3. ✅ Successfully fulfilled ${itemsToFulfill.length} item(s)`);
    logger.info(`  4. ✅ Order status should now be 'fulfilled'`);

  } catch (error: any) {
    logger.error(`❌ Error fulfilling order: ${error.message}`);
    logger.error(`📜 Full error: ${error.stack}`);
    
    // Provide more specific error guidance
    if (error.message.includes("inventory")) {
      logger.error(`💡 This may be an inventory issue - check stock levels`);
    } else if (error.message.includes("fulfillment")) {
      logger.error(`💡 This may be a fulfillment configuration issue`);
    } else if (error.message.includes("reservation")) {
      logger.error(`💡 This may be a reservation issue - check inventory setup`);
    }
  }
}
