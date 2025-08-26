// src/scripts/seed-orders.ts — create 15 completed orders (mock data)

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function seedOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const regionModuleService = container.resolve(Modules.REGION)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const cartModuleService: any = container.resolve(Modules.CART)
  const orderModuleService: any = container.resolve(Modules.ORDER)

  // Access core flows dynamically (if available). We'll fall back to services.
  const flows: any = await import("@medusajs/core-flows").catch(() => ({}))
  const { faker } = await import("@faker-js/faker")

  logger.info("Seeding 15 orders...")

  // Resolve defaults
  const regions = await regionModuleService.listRegions({ currency_code: "eur" })
  const region = regions[0] || (await regionModuleService.listRegions())[0]
  if (!region) {
    logger.warn("No region found. Please run the main seed first.")
    return
  }

  const salesChannels = await salesChannelModuleService.listSalesChannels({ name: "Default Sales Channel" })
  const salesChannel = salesChannels[0]
  if (!salesChannel) {
    logger.warn("No Default Sales Channel found. Please run the main seed first.")
    return
  }

  // Get a few variants to use as line items
  // Fetch variants with product association to build line item titles when not using flows
  const { data: variantRows } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "product_id"],
  })
  if (!variantRows?.length) {
    logger.warn("No variants available to create orders. Seed products first.")
    return
  }

  // Fetch product titles (for nicer line item titles)
  const { data: productRows } = await query.graph({
    entity: "product",
    fields: ["id", "title"],
  })
  const productTitleById = new Map<string, string>()
  for (const p of productRows || []) {
    if (p?.id && p?.title) {
      productTitleById.set(p.id as string, p.title as string)
    }
  }
  const variantInfoById = new Map<string, { product_id?: string; variant_title?: string; product_title?: string }>()
  for (const v of variantRows) {
    const pid = (v.product_id ?? undefined) as string | undefined
    variantInfoById.set(v.id, {
      product_id: pid,
      variant_title: (v.title ?? undefined) as string | undefined,
      product_title: pid ? productTitleById.get(pid) || undefined : undefined,
    })
  }

  // Pick a shipping option applicable to the region
  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id"],
  })
  const shippingOptionId = shippingOptions?.[0]?.id
  if (!shippingOptionId) {
    logger.warn("No shipping options found. Please run the main seed to create shipping options.")
    return
  }

  let createdCount = 0

  // Helper: create a cart via flow or service
  const createCart = async (input: any) => {
    if (typeof flows.createCartsWorkflow === "function") {
      const { result } = await flows.createCartsWorkflow(container).run({ input: { carts: [input] } })
      return result?.[0]
    }
    // Service fallbacks
    if (typeof cartModuleService.createCarts === "function") {
      const result = await cartModuleService.createCarts([input])
      return result?.[0]
    }
    if (typeof cartModuleService.createCart === "function") {
      return await cartModuleService.createCart(input)
    }
    if (typeof cartModuleService.create === "function") {
      return await cartModuleService.create(input)
    }
    throw new Error("No available method to create cart")
  }

  const addLineItems = async (cartId: string, items: any[]) => {
    if (typeof flows.addLineItemsToCartWorkflow === "function") {
      await flows.addLineItemsToCartWorkflow(container).run({ input: { cart_id: cartId, items } })
      return
    }
    // Enrich items with required "title" (and product_id/variant_title) when using service fallback
  const enrichedItems = items.map((it) => {
      const info = variantInfoById.get(it.variant_id) || {}
      const title = info.product_title || info.variant_title || "Item"
      // Default unit price to 10 to match seeded variant prices (eur/usd)
      const unit_price = 10
      return {
        ...it,
        title,
        product_id: info.product_id,
        variant_title: info.variant_title,
        unit_price,
    // Avoid requiring shipping in environments without shipping method APIs
    requires_shipping: false,
      }
    })
  if (typeof cartModuleService.addLineItemsToCart === "function") {
      // Try common call shapes
      try {
        await cartModuleService.addLineItemsToCart({ id: cartId, items: enrichedItems })
        return
      } catch {}
      try {
        await cartModuleService.addLineItemsToCart(cartId, enrichedItems)
        return
      } catch {}
      try {
        await cartModuleService.addLineItemsToCart([{ cart_id: cartId, items: enrichedItems }])
        return
      } catch {}
    }
  if (typeof cartModuleService.addLineItems === "function") {
      try {
        await cartModuleService.addLineItems({ id: cartId, items: enrichedItems })
        return
      } catch {}
      try {
        await cartModuleService.addLineItems(cartId, enrichedItems)
        return
      } catch {}
      try {
        await cartModuleService.addLineItems([{ cart_id: cartId, items: enrichedItems }])
        return
      } catch {}
    }
    // Try some additional variants seen across versions
    if (typeof cartModuleService.addItemsToCart === "function") {
      try {
        await cartModuleService.addItemsToCart({ id: cartId, items: enrichedItems })
        return
      } catch {}
      try {
        await cartModuleService.addItemsToCart(cartId, enrichedItems)
        return
      } catch {}
    }
    if (typeof cartModuleService.addItem === "function") {
      try {
        for (const it of enrichedItems) {
          await cartModuleService.addItem(cartId, it)
        }
        return
      } catch {}
    }
    if (typeof cartModuleService.setLineItems === "function") {
      try {
        await cartModuleService.setLineItems(cartId, enrichedItems)
        return
      } catch {}
    }
    throw new Error("No available method to add line items")
  }

  const updateCart = async (cartId: string, update: any) => {
    if (typeof flows.updateCartsWorkflow === "function") {
      await flows.updateCartsWorkflow(container).run({ input: { selector: { id: cartId }, update } })
      return
    }
    if (typeof cartModuleService.updateCarts === "function") {
      await cartModuleService.updateCarts([{ id: cartId, ...update }])
      return
    }
    if (typeof cartModuleService.updateCart === "function") {
      await cartModuleService.updateCart(cartId, update)
      return
    }
    if (typeof cartModuleService.update === "function") {
      await cartModuleService.update(cartId, update)
      return
    }
    throw new Error("No available method to update cart")
  }

  const addShippingMethod = async (cartId: string, shipping_option_id: string) => {
    if (typeof flows.addShippingMethodsToCartWorkflow === "function") {
      await flows.addShippingMethodsToCartWorkflow(container).run({
        input: { cart_id: cartId, shipping_methods: [{ shipping_option_id }] },
      })
      return
    }
    if (typeof cartModuleService.addShippingMethodsToCart === "function") {
      await cartModuleService.addShippingMethodsToCart(cartId, [{ shipping_option_id }])
      return
    }
    if (typeof cartModuleService.addShippingMethod === "function") {
      await cartModuleService.addShippingMethod(cartId, { shipping_option_id })
      return
    }
  // If no method exists in this environment, skip adding a shipping method.
  logger?.warn?.("Skipping shipping method: no API available in this environment")
  return
  }

  const completeCart = async (cartId: string) => {
    if (typeof flows.completeCartWorkflow === "function") {
      const { result } = await flows.completeCartWorkflow(container).run({ input: { cart_id: cartId } })
      return result
    }
    if (typeof cartModuleService.completeCart === "function") {
      try {
        return await cartModuleService.completeCart({ id: cartId })
      } catch {}
      try {
        return await cartModuleService.completeCart(cartId)
      } catch {}
    }
    if (typeof cartModuleService.complete === "function") {
      try {
        return await cartModuleService.complete({ id: cartId })
      } catch {}
      try {
        return await cartModuleService.complete(cartId)
      } catch {}
    }
    throw new Error("No available method to complete cart")
  }

  // Fallback: directly create an order using the Order module (bypassing cart completion)
  const createOrderDirect = async (payload: any) => {
    // Try flows if available
    if (typeof flows.createOrdersWorkflow === "function") {
      const { result } = await flows.createOrdersWorkflow(container).run({ input: { orders: [payload] } })
      return result?.[0]
    }
    // Try service variants
    if (orderModuleService) {
      if (typeof orderModuleService.createOrders === "function") {
        const res = await orderModuleService.createOrders([payload])
        return res?.[0]
      }
      if (typeof orderModuleService.createOrder === "function") {
        return await orderModuleService.createOrder(payload)
      }
      if (typeof orderModuleService.create === "function") {
        return await orderModuleService.create(payload)
      }
    }
    throw new Error("No available method to create order directly")
  }
  for (let i = 0; i < 15; i++) {
    try {
      const iterStartedAt = new Date().toISOString()
      // 1) Create a cart
      const cart = await createCart({
        region_id: region.id,
        sales_channel_id: salesChannel.id,
        currency_code: region.currency_code,
        email: `seed+${i}@example.com`,
      })
      if (!cart?.id) {
        logger.warn("Failed to create cart; skipping.")
        continue
      }

      // 2) Add 1-3 random items
  const itemCount = faker.number.int({ min: 1, max: 3 })
  const chosen = faker.helpers.arrayElements(variantRows, itemCount)
      await addLineItems(
        cart.id,
        chosen.map((v: any) => ({
          variant_id: v.id,
          quantity: faker.number.int({ min: 1, max: 3 }),
        }))
      )

      // Optional: verify items persisted (best-effort)
      try {
        const { data: li } = await query.graph({
          entity: "line_item",
          fields: ["id", "cart_id"],
          // @ts-ignore: filters may not be available in all runtimes
          filters: { cart_id: cart.id },
        })
        logger.info(`Cart ${cart.id} now has ${Array.isArray(li) ? li.length : 0} item(s)`) 
      } catch {}

      // 3) Set addresses and email
      const shipping_address = {
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
        address_1: faker.location.streetAddress(),
        city: faker.location.city(),
        postal_code: faker.location.zipCode(),
        country_code: "dk", // within seeded Europe region
        phone: faker.phone.number(),
      }
      const billing_address = shipping_address

      await updateCart(cart.id, {
        email: `seed+${i}@example.com`,
        shipping_address,
        billing_address,
      })

      // 4) Add shipping method
  await addShippingMethod(cart.id, shippingOptionId)

      // 5) Complete the cart (creates order)
      const completion = await completeCart(cart.id).catch(() => undefined)

      let orderId = completion?.order?.id || completion?.id

      // If completion didn't yield a new order, create one directly
      if (!orderId) {
        const orderPayload = {
          email: `seed+${i}@example.com`,
          region_id: region.id,
          sales_channel_id: salesChannel.id,
          currency_code: region.currency_code,
          shipping_address,
          billing_address,
          items: (chosen as any[]).map((v: any) => {
            const info = variantInfoById.get(v.id) || {}
            return {
              title: info.product_title || info.variant_title || "Item",
              unit_price: 10,
              quantity: faker.number.int({ min: 1, max: 3 }),
              requires_shipping: false,
              product_id: info.product_id,
              variant_id: v.id,
              variant_title: info.variant_title,
            }
          }),
        }
        const createdOrder = await createOrderDirect(orderPayload)
        orderId = createdOrder?.id
      }
      if (orderId) {
        createdCount++
        logger.info(`Created order ${orderId}`)
      } else {
        logger.warn("Cart completion returned no order; skipping.")
      }
    } catch (e: any) {
      logger.warn(`Failed to create order ${i + 1}: ${e?.message || e}`)
    }
  }

  logger.info(`✅ Finished creating ${createdCount} order(s).`)
}
