import {
  CartDTO,
  CreateLineItemDTO,
  ICartModuleService,
  ICustomerModuleService,
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
} from "@medusajs/types"
import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/utils"
import { completeCartWorkflow } from "@medusajs/core-flows"

// The main function that will be executed by the Medusa CLI
export default async function seedOrders({ container }: { container: any }) {
  // Dynamically import faker to handle ESM module in CJS environment
  const { faker } = await import("@faker-js/faker")

  const logger = container.resolve("logger")
  const remoteQuery = container.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  // Resolving necessary services from the Medusa container
  const cartModuleService: ICartModuleService = container.resolve(Modules.CART)
  const regionModuleService: IRegionModuleService =
    container.resolve(Modules.REGION)
  const customerModuleService: ICustomerModuleService =
    container.resolve(Modules.CUSTOMER)
  const productModuleService: IProductModuleService =
    container.resolve(Modules.PRODUCT)
  const salesChannelModuleService: ISalesChannelModuleService =
    container.resolve(Modules.SALES_CHANNEL)

  // --- CONFIGURATION ---
  const NUMBER_OF_ORDERS_TO_CREATE = 10
  // ---------------------

  logger.info(`Seeding ${NUMBER_OF_ORDERS_TO_CREATE} dummy orders...`)

  try {
    // 1. Fetch prerequisite data (products, regions, customers, etc.)
    // ----------------------------------------------------------------
    const [products] = await productModuleService.listAndCountProducts(
      { is_giftcard: false },
      {
        select: [
          "title",
          "variants.id",
          // removed: "variants.calculated_price.calculated_amount"
        ],
        take: 100,
      }
    )
    const [regions] = await regionModuleService.listAndCountRegions(
      {},
      { select: ["id", "currency_code"], take: 10 }
    )
    const [customers] = await customerModuleService.listAndCountCustomers(
      {},
      { select: ["id", "email"], take: 50 }
    )
    const [salesChannels] =
      await salesChannelModuleService.listAndCountSalesChannels(
        {},
        { select: ["id"], take: 10 }
      )

    // Basic validation to ensure we can create orders
    if (!products.length) {
      logger.warn(
        "No products found. Please seed products first. Aborting order seeding."
      )
      return
    }
    if (!regions.length) {
      logger.warn(
        "No regions found. Please create a region first. Aborting order seeding."
      )
      return
    }
    if (!customers.length) {
      logger.warn(
        "No customers found. Please seed customers first. Aborting order seeding."
      )
      return
    }

    // 2. Loop to create the specified number of orders
    // ----------------------------------------------------------------
    for (let i = 0; i < NUMBER_OF_ORDERS_TO_CREATE; i++) {
      const randomCustomer =
        customers[Math.floor(Math.random() * customers.length)]
      const randomRegion = regions[Math.floor(Math.random() * regions.length)]
      const randomSalesChannel =
        salesChannels[Math.floor(Math.random() * salesChannels.length)]

      // Create a cart for the order
      const [createdCart] = await cartModuleService.createCarts([
        {
          region_id: randomRegion.id,
          customer_id: randomCustomer.id,
          email: randomCustomer.email,
          currency_code: randomRegion.currency_code,
          sales_channel_id: randomSalesChannel.id,
        },
      ])
      let cart: CartDTO = createdCart

      logger.info(`Created cart ${cart.id} for customer ${randomCustomer.email}`)

      // Add 1 to 3 random products to the cart
      const itemsToAddCount = Math.floor(Math.random() * 3) + 1
      const lineItems: CreateLineItemDTO[] = []

      for (let j = 0; j < itemsToAddCount; j++) {
        const randomProduct =
          products[Math.floor(Math.random() * products.length)]
        if (randomProduct.variants && randomProduct.variants.length > 0) {
          const variant = randomProduct.variants[0]

          // Try to derive a unit price from various possible variant price shapes.
          // Use `any` to avoid TypeScript errors when the shape differs across Medusa versions.
          const unit_price =
            (variant as any).calculated_price?.calculated_amount ??
            (variant as any).prices?.[0]?.amount ??
            (variant as any).price ??
            0

          lineItems.push({
            title: randomProduct.title ?? "",
            unit_price,
            variant_id: variant.id,
            quantity: Math.floor(Math.random() * 5) + 1,
          } as CreateLineItemDTO)
        }
      }
      if (lineItems.length > 0) {
        await cartModuleService.addLineItems(cart.id, lineItems)
      }

      // Add a shipping address
      const shippingAddress = {
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
        address_1: faker.location.streetAddress(),
        city: faker.location.city(),
        country_code: "us",
        postal_code: faker.location.zipCode(),
        phone: faker.phone.number(),
      }

      cart = await cartModuleService.updateCarts(cart.id, {
        shipping_address: shippingAddress,
        billing_address: shippingAddress, // Using same for simplicity
      })

      // Fetch available shipping options for the cart
      const shippingOptionsQuery = remoteQueryObjectFromString({
        entryPoint: "shipping_option",
        fields: ["id"],
        variables: {
          filters: {
            is_return: false,
            service_zone: {
              fulfillment_set: {
                service_zones: {
                  shipping_options: {
                    sales_channel_id: [cart.sales_channel_id],
                  },
                },
              },
            },
          },
        },
      })

      const shippingOptions = await remoteQuery(shippingOptionsQuery)

      if (shippingOptions.length > 0) {
        const firstOption = shippingOptions[0]

        // Include required name and amount fields (use values from the shipping option or fallbacks).
        await cartModuleService.addShippingMethods(cart.id, [
          {
            shipping_option_id: firstOption.id,
            name: firstOption.name ?? "Shipping",
            amount: firstOption.amount ?? firstOption.price ?? 0,
          } as any,
        ])
      } else {
        logger.warn(
          `No shipping options found for sales channel ${cart.sales_channel_id}. Skipping shipping method for cart ${cart.id}.`
        )
      }

      // Remove createPaymentSession call; completeCartWorkflow will handle payment flow in this setup

      // 3. Complete the cart to create the order
      // ----------------------------------------------------------------
      const { result: order, errors } = await completeCartWorkflow(
        container
      ).run({
        input: { id: cart.id },
      })

      if (errors && errors.length > 0) {
        logger.error(
          `Failed to create order from cart ${cart.id}:`,
          errors.map((e) => e.error.message).join("\n")
        )
      } else if (order) {
        logger.info(`Successfully created order ${order.id} from cart ${cart.id}`)
      }
    }

    logger.info(
      `Finished seeding ${NUMBER_OF_ORDERS_TO_CREATE} dummy orders.`
    )
  } catch (err) {
    logger.error("Error seeding orders:", err)
  }
}
