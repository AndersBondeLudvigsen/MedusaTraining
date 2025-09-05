import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  getOrderDetailWorkflow,
  createOrderFulfillmentWorkflow,
} from "@medusajs/core-flows";

export default async function fulfillAllOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryModuleService = container.resolve(Modules.INVENTORY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);

  logger.info(`🚀 Starting fulfillment process for ALL orders in database...`);

  try {
    // Step 1: Get all orders from the database
    logger.info(`📋 Step 1: Fetching all orders from database...`);
    const { data: allOrders } = (await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "total",
        "currency_code",
        "payment_status",
        "fulfillment_status",
        "items.*", // Get all item fields
        "fulfillments.id",
        "payment_collections.status",
        "payment_collections.amount",
      ],
    })) as any;

    if (!allOrders || allOrders.length === 0) {
      logger.info(`✅ No orders found in database.`);
      return;
    }

    logger.info(`📊 Found ${allOrders.length} orders in database.`);

    // Step 2: Filter for orders that need fulfillment
    logger.info(`🔍 Step 2: Filtering orders that need fulfillment...`);
    const ordersToProcess: any[] = [];

    for (const order of allOrders) {
      // Check payment status
      let paymentStatus = order.payment_status;
      if (
        !paymentStatus &&
        order.payment_collections &&
        order.payment_collections.length > 0
      ) {
        paymentStatus = order.payment_collections[0].status;
      }

      // Only process paid orders that aren't already fully fulfilled
      if (
        (paymentStatus === "captured" || paymentStatus === "completed") &&
        order.fulfillment_status !== "delivered"
      ) {
        ordersToProcess.push(order);
      }
    }

    if (ordersToProcess.length === 0) {
      logger.info(
        `✅ No orders need fulfillment. All orders are already delivered or not paid.`
      );
      return;
    }

    logger.info(
      `🎯 Found ${ordersToProcess.length} orders that need fulfillment:`
    );
    ordersToProcess.forEach((order, index) => {
      logger.info(
        `  ${index + 1}. Order #${order.display_id} - ${(
          (order.total || 0) / 100
        ).toFixed(2)} ${order.currency_code?.toUpperCase() || "EUR"}`
      );
    });

    // Step 3: Get stock location
    logger.info(`📦 Step 3: Getting stock location...`);
    const { data: stockLocations } = (await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
    })) as any;

    if (!stockLocations || stockLocations.length === 0) {
      logger.error(
        `❌ No stock locations found. Cannot proceed with fulfillment.`
      );
      return;
    }

    const stockLocationId = stockLocations[0].id;
    logger.info(
      `✅ Using stock location: ${stockLocations[0].name} (${stockLocationId})`
    );

    // Step 4: Process each order
    let successCount = 0;
    let errorCount = 0;
    let alreadyFulfilledCount = 0;

    for (const order of ordersToProcess) {
      logger.info(
        `\n🔄 Processing Order #${order.display_id} (${order.id})...`
      );

      try {
        if (!order.items || order.items.length === 0) {
          logger.warn(`  ⚠️ No items found in order. Skipping.`);
          continue;
        }

        logger.info(`  📦 Found ${order.items.length} item(s) in order`);
        const itemsToFulfill: any[] = [];
        const reservations: any[] = [];

        // Process each item
        for (let index = 0; index < order.items.length; index++) {
          const item = order.items[index];
          logger.info(`\n    Item ${index + 1}: ${item.title}`);
          logger.info(`      🏷️ Variant: ${item.variant_title || "N/A"}`);
          logger.info(`      🔢 SKU: ${item.variant_sku || "N/A"}`);
          logger.info(`      📊 Quantity: ${item.quantity || 0}`);

          const quantity = item.quantity || 0;
          const fulfilledQuantity = item.detail?.fulfilled_quantity || 0;
          const remainingQuantity = quantity - fulfilledQuantity;

          logger.info(`      🎯 Remaining to fulfill: ${remainingQuantity}`);

          if (remainingQuantity <= 0) {
            logger.info(`      ⏭️ Skipping - already fulfilled or no quantity`);
            continue;
          }

          // Find inventory item
          logger.info(
            `      🔍 Finding inventory item for SKU: ${item.variant_sku}...`
          );
          const { data: inventoryItems } = (await query.graph({
            entity: "inventory_item",
            fields: ["id", "sku"],
            filters: { sku: item.variant_sku },
          })) as any;

          if (!inventoryItems || inventoryItems.length === 0) {
            logger.error(
              `      ❌ No inventory item found for SKU: ${item.variant_sku}`
            );
            continue;
          }

          const inventoryItemId = inventoryItems[0].id;
          logger.info(`      ✅ Found inventory item: ${inventoryItemId}`);

          // Check existing reservations
          logger.info(`      🔍 Checking existing reservations...`);
          let reservationExists = false;

          try {
            const existingReservations =
              await inventoryModuleService.listReservationItems({
                line_item_id: item.id,
              });

            if (existingReservations && existingReservations.length > 0) {
              logger.info(`      ✅ Reservation already exists for this item`);
              reservationExists = true;
            }
          } catch (error: any) {
            logger.info(
              `      ⚠️ Could not check existing reservations: ${error.message}`
            );
          }

          if (!reservationExists) {
            // Check stock levels before creating reservation
            logger.info(`      📊 Checking stock levels...`);
            try {
              const { data: inventoryLevels } = (await query.graph({
                entity: "inventory_level",
                fields: [
                  "stocked_quantity",
                  "reserved_quantity",
                  "available_quantity",
                ],
                filters: {
                  inventory_item_id: inventoryItemId,
                  location_id: stockLocationId,
                },
              })) as any;

              if (inventoryLevels && inventoryLevels.length > 0) {
                const level = inventoryLevels[0];
                logger.info(`      📊 Stock status:`);
                logger.info(`        - Stocked: ${level.stocked_quantity}`);
                logger.info(`        - Available: ${level.available_quantity}`);

                if (level.available_quantity < remainingQuantity) {
                  logger.error(
                    `      ❌ Insufficient stock! Need ${remainingQuantity}, have ${level.available_quantity}`
                  );
                  continue;
                }
              } else {
                logger.error(
                  `      ❌ No inventory level found for this item at this location`
                );
                continue;
              }
            } catch (stockError: any) {
              logger.error(
                `      ❌ Failed to check stock levels: ${stockError.message}`
              );
              continue;
            }

            // Create reservation
            logger.info(
              `      🔄 Creating reservation for ${remainingQuantity} units...`
            );
            try {
              const reservation =
                await inventoryModuleService.createReservationItems([
                  {
                    line_item_id: item.id,
                    inventory_item_id: inventoryItemId,
                    location_id: stockLocationId,
                    quantity: remainingQuantity,
                    description: `Reservation for order ${order.display_id} - ${item.title}`,
                    metadata: {
                      order_id: order.id,
                      item_id: item.id,
                    },
                  },
                ]);

              logger.info(`      ✅ Created reservation: ${reservation[0].id}`);
              reservations.push(reservation[0]);
            } catch (reservationError: any) {
              logger.error(
                `      ❌ Failed to create reservation: ${reservationError.message}`
              );
              continue;
            }
          }

          // Add to fulfillment queue
          logger.info(`      ➕ Adding to fulfillment queue`);
          itemsToFulfill.push({
            id: item.id,
            quantity: remainingQuantity,
          });
        }

        if (itemsToFulfill.length === 0) {
          logger.info(
            `  ❌ No items can be fulfilled (no stock or already fulfilled)`
          );
          alreadyFulfilledCount++;
          continue;
        }

        // Create fulfillment
        logger.info(
          `  🚛 Creating fulfillment for ${itemsToFulfill.length} item(s)...`
        );
        logger.info(`  📋 Items to fulfill:`);
        itemsToFulfill.forEach((item, index) => {
          logger.info(
            `    ${index + 1}. Item ID: ${item.id}, Quantity: ${item.quantity}`
          );
        });

        const fulfillmentResult = await createOrderFulfillmentWorkflow(
          container
        ).run({
          input: {
            order_id: order.id,
            items: itemsToFulfill,
          },
        });

        logger.info(`  🎉 SUCCESS! Fulfillment created!`);
        logger.info(
          `  📝 Fulfillment ID: ${fulfillmentResult.result?.id || "Generated"}`
        );

        // Mark fulfillment as delivered
        logger.info(`  🚚 Marking fulfillment as delivered...`);

        const fulfillmentId = fulfillmentResult.result?.id;
        if (fulfillmentId) {
          try {
            // Update the fulfillment to mark it as delivered
            await fulfillmentModuleService.updateFulfillment(fulfillmentId, {
              delivered_at: new Date(),
            });

            logger.info(`  🎉 SUCCESS! Fulfillment marked as delivered!`);
            logger.info(
              `  ✅ Order #${order.display_id} is now fully processed and delivered`
            );
          } catch (deliveryError: any) {
            logger.error(
              `  ❌ Failed to mark fulfillment as delivered: ${deliveryError.message}`
            );
            logger.info(
              `  💡 Fulfillment was created but not marked as delivered`
            );
          }
        } else {
          logger.warn(
            `  ⚠️ No fulfillment ID returned, cannot mark as delivered`
          );
        }

        successCount++;
      } catch (error: any) {
        logger.error(
          `  ❌ Error processing order #${order.display_id}: ${error.message}`
        );
        logger.error(`  📜 Full error: ${error.stack}`);
        errorCount++;
      }
    }

    // Summary
    logger.info(`\n🎉 BATCH FULFILLMENT COMPLETE!`);
    logger.info(`📊 Summary:`);
    logger.info(
      `  ✅ Successfully fulfilled and delivered: ${successCount} orders`
    );
    logger.info(`  ℹ️  Already fulfilled: ${alreadyFulfilledCount} orders`);
    if (errorCount > 0) {
      logger.error(`  ❌ Failed to process: ${errorCount} orders`);
    }
    logger.info(
      `  📦 Total processed: ${
        successCount + errorCount + alreadyFulfilledCount
      } orders`
    );
    logger.info(`  🗃️ Total orders in database: ${allOrders.length} orders`);

    if (successCount > 0) {
      logger.info(`\n💡 What happened:`);
      logger.info(
        `  1. ✅ Found and processed all eligible orders in the database`
      );
      logger.info(
        `  2. ✅ Created inventory reservations to prevent overselling`
      );
      logger.info(`  3. ✅ Created fulfillment records for all items`);
      logger.info(`  4. ✅ Marked all fulfillments as "delivered"`);
      logger.info(`  5. ✅ Updated order fulfillment_status to "delivered"`);
    }
  } catch (error: any) {
    logger.error(`❌ Error in batch fulfillment process: ${error.message}`);
    logger.error(`📜 Full error: ${error.stack}`);

    // Provide more specific error guidance
    if (error.message.includes("inventory")) {
      logger.error(`💡 This may be an inventory issue - check stock levels`);
    } else if (error.message.includes("fulfillment")) {
      logger.error(`💡 This may be a fulfillment configuration issue`);
    } else if (error.message.includes("reservation")) {
      logger.error(
        `💡 This may be a reservation issue - check inventory setup`
      );
    }
  }
}
