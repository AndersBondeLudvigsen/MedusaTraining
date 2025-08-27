import { ExecArgs } from "@medusajs/framework/types";
import { 
  createOrderWorkflow,
  createCustomersWorkflow
} from "@medusajs/medusa/core-flows";
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
  let { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "email"],
  });

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
    customers = result;
    logger.info(`Successfully created customer with email: ${customers[0].email}`);
  }

  // Get other necessary data
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
  });

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.prices"],
  });
  
  const { data: shipping_options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "data", "price_type", "prices.amount", "shipping_profile_id", "provider_id", "type", "rules", "service_zone_id"],
  });
  
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
    const product = products[Math.floor(Math.random() * products.length)];
    const variant = product.variants[Math.floor(Math.random() * product.variants.length)];
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
      country_code: "us",
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
      items: [
        {
          variant_id: variant.id,
          quantity: Math.floor(Math.random() * 3) + 1
        }
      ],
      shipping_methods: [
        {
          name: shipping_option.name,
          option_id: shipping_option.id,
          data: shipping_option.data || {},
          amount: shipping_option.prices[0]?.amount || 1000,
          shipping_profile_id: shipping_option.shipping_profile_id,
          provider_id: shipping_option.provider_id,
          type: shipping_option.type,
          rules: shipping_option.rules,
        }
      ],
      metadata: {}
    };

    try {
      const { result } = await createOrderWorkflow(container).run({
        input: orderData,
      });
      logger.info(`Created order with ID: ${result.id}`);
    } catch (error) {
      logger.error(`Failed to create order: ${error.message}`);
    }
  }

  logger.info(`Attempted to seed ${ordersNum} orders.`);
}