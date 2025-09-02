import type { ExecArgs } from "@medusajs/framework/types";
import { Client as PgClient } from "pg";
import { createOrderWorkflow, createCustomersWorkflow } from "@medusajs/core-flows";
// Use core-flows for payment/fulfillment helpers
import {
  getOrderDetailWorkflow,
  createOrderFulfillmentWorkflow,
  createOrUpdateOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/core-flows";
import { 
  Modules,
  ContainerRegistrationKeys
} from "@medusajs/framework/utils";
import {
  createStockLocationsWorkflow,
  createInventoryLevelsWorkflow,
  createShippingProfilesWorkflow,
  createShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function seedDummyOrders({
  container,
}: ExecArgs) {
  const { faker } = await import('@faker-js/faker');
  const logger = container.resolve(
    ContainerRegistrationKeys.LOGGER
  );
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  );
  const link = container.resolve(
    ContainerRegistrationKeys.LINK
  );

  // Check for existing customers
  let { data: customers } = (await query.graph({
    entity: "customer",
    fields: ["id", "email"],
  })) as { data: Array<{ id: string; email: string }> };

  // If no customers exist, create one
  if (!customers.length) {
    logger.info("No customers found. Creating a new customer...");
    const { result } = await createCustomersWorkflow(container).run({
      input: {
        customersData: [{
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
        }],
      },
    });
    // Re-query customers to align with Query response type
    const requery = (await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email: result[0].email },
    })) as { data: Array<{ id: string; email: string }> };
    customers = requery.data?.length ? requery.data : customers;
    logger.info(`Successfully created customer with email: ${customers[0].email}`);
  }

  // Get other necessary data
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
  });

  const { data: products } = (await query.graph({
    entity: "product",
    // Use product title, variant id, and variant prices to compute original unit price
    fields: [
      "id",
      "title",
      "variants.id",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
  })) as {
    data: Array<{
      id: string
      title: string
      variants?: Array<{
        id: string
        prices?: Array<{ amount: number; currency_code: string }>
      }>
    }>
  };
  
  let { data: shipping_options } = (await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "data",
      "price_type",
      "shipping_profile_id",
      "provider_id",
      "type.code",
      "service_zone_id",
    ],
  })) as { data: Array<{ id: string; name: string }> };
  
  if (!products.length) {
    logger.warn("No products found. Please seed products before seeding orders.");
    return;
  }

  const salesChannelModuleService = container.resolve(
    Modules.SALES_CHANNEL
  );

  const defaultSalesChannel = await salesChannelModuleService
    .listSalesChannels({
      name: "Default Sales Channel",
    });

  // Ensure stock location exists and is linked to the default sales channel; ensure basic shipping option as well
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const storeModuleService = container.resolve(Modules.STORE);

  // 1) Ensure at least one stock location
  let { data: stock_locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  }) as { data: Array<{ id: string; name: string }> };

  if (!stock_locations.length) {
    const { result: locs } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Default Warehouse",
            address: { city: "Copenhagen", country_code: "DK", address_1: "" },
          },
        ],
      },
    })
    stock_locations = locs
  }
  const stockLocationId = stock_locations[0].id

  // 2) Link default sales channel to stock location (idempotent)
  if (defaultSalesChannel?.[0]?.id) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocationId, add: [defaultSalesChannel[0].id] },
    })
  }

  // 3) Ensure inventory levels exist for all inventory items at this location
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  }) as { data: Array<{ id: string }> }

  // Check existing levels to avoid duplicates
  const { data: existingLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id"],
    filters: { location_id: stockLocationId },
  }) as { data: Array<{ inventory_item_id: string }> }

  const existingSet = new Set(existingLevels.map((l) => l.inventory_item_id))
  const levelsToCreate = inventoryItems
    .filter((ii) => !existingSet.has(ii.id))
    .map((ii) => ({
      location_id: stockLocationId,
      stocked_quantity: 1_000_000,
      inventory_item_id: ii.id,
    }))

  if (levelsToCreate.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: levelsToCreate },
    })
  }

  // 4) Ensure a shipping option exists; if none, create minimal profile + option
  if (!shipping_options.length) {
    // Ensure default profile exists
    const profiles = await fulfillmentModuleService.listShippingProfiles({ type: "default" })
    let shippingProfile = profiles[0]
    if (!shippingProfile) {
      const { result: profs } = await createShippingProfilesWorkflow(container).run({
        input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
      })
      shippingProfile = profs[0]
    }

    // Create a simple service zone via fulfillment set
    const countries = ["dk"]
    const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "Default delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Default Zone",
          geo_zones: countries.map((c) => ({ country_code: c, type: "country" as const })),
        },
      ],
    })

    // Link stock location to manual provider and to the new fulfillment set (ignore duplicates)
    try {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
      })
    } catch {}

    try {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
      })
    } catch {}

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Standard Shipping",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfile.id,
          type: { label: "Standard", description: "Ship in 2-3 days.", code: "standard" },
          prices: [
            { currency_code: "usd", amount: 10 },
            { currency_code: "eur", amount: 10 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })

    // re-fetch
    const soRe = await query.graph({
      entity: "shipping_option",
      fields: ["id", "name"],
    }) as { data: Array<{ id: string; name: string }> }
    shipping_options = soRe.data
  }

  // Generate 5 orders
  const ordersNum = 5;

  for (let i = 0; i < ordersNum; i++) {
    // Select random data for this order
    const region = regions[Math.floor(Math.random() * regions.length)];
    const customer = customers[Math.floor(Math.random() * customers.length)];
    // Build a mixed set of 1-3 items per order using different products
    const itemsCount = Math.max(1, Math.floor(Math.random() * 3) + 0);
    const pickedIndexes = new Set<number>();
    const pickedItems: any[] = [];
    while (pickedItems.length < itemsCount && pickedIndexes.size < products.length) {
      const idx = Math.floor(Math.random() * products.length);
      if (pickedIndexes.has(idx)) continue;
      pickedIndexes.add(idx);
      const product = products[idx];
      const variant = (product.variants && product.variants.length)
        ? product.variants[Math.floor(Math.random() * product.variants.length)]
        : null;
      if (!variant) continue;
      // Compute unit price from variant's original prices matching region currency
      const priceMatch = (variant as any).prices?.find((p: any) => p.currency_code === region.currency_code);
      const unit_price = priceMatch?.amount ?? (variant as any).prices?.[0]?.amount ?? 2500;
      pickedItems.push({
        title: product.title,
        unit_price,
        variant_id: variant.id,
        quantity: Math.floor(Math.random() * 3) + 1,
      } as any);
    }
    const shipping_option = shipping_options[Math.floor(Math.random() * shipping_options.length)];

    if (!customer.email) {
      logger.warn(`Customer with ID ${customer.id} has no email, skipping order creation.`);
      continue;
    }

    // Create address data
    const address = {
      first_name: faker.person.firstName(),
      last_name: faker.person.lastName(),
      phone: faker.phone.number(),
      company: faker.company.name(),
      address_1: faker.location.streetAddress(),
      address_2: faker.location.secondaryAddress(),
      city: faker.location.city(),
      country_code:
        (Array.isArray((region as any).countries) &&
          (region as any).countries[0]?.iso_2?.toLowerCase()) || "de",
      province: faker.location.state(),
      postal_code: faker.location.zipCode(),
      metadata: {}
    };

    // Create order data
    const orderData = {
      email: customer.email,
      customer_id: customer.id,
      region_id: region.id,
      currency_code: region.currency_code,
      sales_channel_id: defaultSalesChannel[0].id,
      shipping_address: address,
      billing_address: address,
  // Provide items using original prices pulled from variant prices
  items: pickedItems,
      shipping_methods: [
        {
          option_id: shipping_option.id,
          name: shipping_option.name,
          amount: 1000,
          // data can be set if provider requires it
          data: {},
        }
      ],
      metadata: {}
    };

    try {
      const { result: order } = await createOrderWorkflow(container).run({
        input: orderData,
      });
      logger.info(`Created order with ID: ${order.id}`);

      // Backdate created_at to a random day within the last year (dev/seed only)
      try {
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - 365);
        const offsetDays = Math.floor(Math.random() * 365);
        const backdated = new Date(start);
        backdated.setDate(start.getDate() + offsetDays);

        const dbUrl = process.env.DATABASE_URL || "";
        if (dbUrl.startsWith("postgres")) {
          const pg = new PgClient({ connectionString: dbUrl });
          await pg.connect();
          try {
            const candidates = [
              '"order"',            // common for Medusa v2
              'orders',               // fallback
              'order_order'           // module-style naming fallback
            ];
            let updated = 0;
            for (const table of candidates) {
              const res = await pg.query(
                `update ${table} set created_at = $1, updated_at = case when updated_at < $1 then $1 else updated_at end where id = $2`,
                [backdated.toISOString(), order.id]
              );
              updated += res.rowCount || 0;
              if (res.rowCount) break;
            }
            if (updated) {
              logger.info(`Backdated order ${order.id} created_at -> ${backdated.toISOString()} (rows: ${updated})`);
            } else {
              logger.warn(`Could not locate order table to backdate ${order.id}. Tried common table names.`);
            }
          } finally {
            await pg.end().catch(() => {});
          }
        } else {
          logger.warn('DATABASE_URL is not Postgres; skipping hard backdate.');
        }
      } catch (e: any) {
        logger.warn(`Failed to backdate created_at for ${order.id}: ${e?.message ?? e}`);
      }

      

      // Fetch order detail to get items and payment collections
      const { result: detail } = await getOrderDetailWorkflow(container).run({
        input: {
          order_id: order.id,
          fields: [
            "id",
            "items.id",
            "items.quantity",
            "payment_collections.id",
            "total",
            "payment_status",
            "fulfillment_status",
          ],
        },
      });

      // Ensure a payment collection exists and mark it as paid
      let paymentCollectionId = detail.payment_collections?.[0]?.id;
      if (!paymentCollectionId) {
        const { result: pcs } =
          await createOrUpdateOrderPaymentCollectionWorkflow(container).run({
            input: {
              order_id: order.id,
              amount: Math.round(Number(detail.total || 0)),
            },
          });
        paymentCollectionId = pcs?.[0]?.id;
      }

      if (paymentCollectionId) {
        await markPaymentCollectionAsPaid(container).run({
          input: {
            order_id: order.id,
            payment_collection_id: paymentCollectionId,
          },
        });
        logger.info(`Marked order ${order.id} as paid.`);
      } else {
        logger.warn(
          `No payment collection for order ${order.id}; skipping mark-as-paid.`
        );
      }

      // Create a fulfillment for all items in the order
      const itemsForFulfillment = (detail.items || [])
        .filter((it: any) => !!it?.id && !!it?.quantity)
        .map((it: any) => ({ id: it.id, quantity: it.quantity }));

      if (itemsForFulfillment.length) {
        await createOrderFulfillmentWorkflow(container).run({
          input: {
            order_id: order.id,
            items: itemsForFulfillment,
          },
        });
        logger.info(`Fulfilled order ${order.id}.`);
      } else {
        logger.warn(
          `Order ${order.id} has no items to fulfill; skipping fulfillment.`
        );
      }
    } catch (error) {
      logger.error(`Failed to create order: ${error.message}`);
    }
  }

  logger.info(`Attempted to seed ${ordersNum} orders.`);
}