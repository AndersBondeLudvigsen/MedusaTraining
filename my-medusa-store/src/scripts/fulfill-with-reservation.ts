import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createOrderFulfillmentWorkflow,
} from "@medusajs/core-flows";

export default async function fulfillWithReservation({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryModuleService = container.resolve(Modules.INVENTORY);
  
  // Specific order ID to test with
  const orderId = "order_01K4C72SVZ0PT1SBNHDQ9AZCXX"; // Order #407
  
  logger.info(`🚀 Creating reservations and fulfilling order: ${orderId}`);

  try {
    // Step 1: Get order details
    logger.info(`📋 Step 1: Fetching order details...`);
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
        "items.variant_id",
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
    logger.info(`✅ Order found: #${order.display_id}`);
    logger.info(`  Payment Status: ${order.payment_status}`);
    logger.info(`  Fulfillment Status: ${order.fulfillment_status}`);

    if (order.payment_status !== "captured") {
      logger.error(`❌ Order payment status is '${order.payment_status}' - only captured orders can be fulfilled.`);
      return;
    }

    // Step 2: Check inventory items and stock locations
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

    // Step 3: Process each item to create reservations
    logger.info(`🔧 Step 3: Creating inventory reservations...`);
    const itemsToFulfill: any[] = [];
    const reservations: any[] = [];

    for (const item of order.items) {
      const quantity = item.quantity || 0;
      const fulfilledQuantity = item.fulfilled_quantity || 0;
      const remainingQuantity = quantity - fulfilledQuantity;

      logger.info(`📦 Processing item: ${item.title} (${item.variant_title})`);
      logger.info(`  - Quantity: ${quantity}, Fulfilled: ${fulfilledQuantity}, Remaining: ${remainingQuantity}`);

      if (remainingQuantity <= 0) {
        logger.info(`  ⏭️  Skipping - already fulfilled`);
        continue;
      }

      // Find the inventory item for this variant
      const { data: inventoryItems } = await query.graph({
        entity: "inventory_item",
        fields: ["id", "sku"],
        filters: { sku: item.variant_sku },
      }) as any;

      if (!inventoryItems || inventoryItems.length === 0) {
        logger.error(`❌ No inventory item found for SKU: ${item.variant_sku}`);
        continue;
      }

      const inventoryItemId = inventoryItems[0].id;
      logger.info(`  ✅ Found inventory item: ${inventoryItemId} for SKU: ${item.variant_sku}`);

      // Check if there's already a reservation for this item
      logger.info(`  🔍 Checking existing reservations...`);
      try {
        const existingReservations = await inventoryModuleService.listReservationItems({
          line_item_id: item.id,
        });

        if (existingReservations && existingReservations.length > 0) {
          logger.info(`  ✅ Reservation already exists for this item`);
        } else {
          // Create reservation
          logger.info(`  🔄 Creating reservation for ${remainingQuantity} units...`);
          
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

          logger.info(`  ✅ Created reservation: ${reservation[0].id}`);
          reservations.push(reservation[0]);
        }
      } catch (reservationError: any) {
        logger.error(`  ❌ Failed to create reservation: ${reservationError.message}`);
        logger.info(`  💡 This might be due to insufficient inventory. Let's check stock levels...`);
        
        // Check stock levels
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
            logger.info(`  📊 Stock levels:`);
            logger.info(`    - Stocked: ${level.stocked_quantity}`);
            logger.info(`    - Reserved: ${level.reserved_quantity}`);
            logger.info(`    - Available: ${level.available_quantity}`);
            
            if (level.available_quantity < remainingQuantity) {
              logger.error(`    ❌ Insufficient stock! Need ${remainingQuantity}, have ${level.available_quantity}`);
              continue;
            }
          } else {
            logger.error(`    ❌ No inventory level found for this item at this location`);
            continue;
          }
        } catch (stockError: any) {
          logger.error(`  ❌ Failed to check stock levels: ${stockError.message}`);
          continue;
        }
      }

      // Add to fulfillment queue
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
    logger.info(`🚛 Step 4: Creating fulfillment for ${itemsToFulfill.length} item(s)...`);
    itemsToFulfill.forEach((item, index) => {
      logger.info(`  ${index + 1}. Item ID: ${item.id}, Quantity: ${item.quantity}`);
    });

    logger.info(`🔄 Running fulfillment workflow...`);
    const fulfillmentResult = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: orderId,
        items: itemsToFulfill,
      },
    });

    logger.info(`🎉 SUCCESS! Fulfillment created!`);
    logger.info(`📝 Fulfillment ID: ${fulfillmentResult.result?.id || 'Unknown'}`);
    
    // Step 5: Verify the result
    logger.info(`🔍 Step 5: Verifying fulfillment...`);
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
    logger.info(`  1. ✅ Created inventory reservations for ${reservations.length} new item(s)`);
    logger.info(`  2. ✅ Allocated inventory to prevent overselling`);
    logger.info(`  3. ✅ Created fulfillment record`);
    logger.info(`  4. ✅ Updated order status to reflect fulfillment`);

  } catch (error: any) {
    logger.error(`❌ Error: ${error.message}`);
    logger.error(`📜 Stack: ${error.stack}`);
  }
}
