import type { ExecArgs } from "@medusajs/framework/types";
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
  
  const { data: shipping_options } = (await query.graph({
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