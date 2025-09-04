// src/scripts/seed-order.ts — Medusa v2 exec script
// Creates two demo orders:
//   A) paid + fully fulfilled
//   B) paid + fulfilled, then returned & refunded

import type { ExecArgs } from "@medusajs/framework/types"
import { Client as PgClient } from "pg"

import {
  createCustomersWorkflow,
  createOrderWorkflow,
  getOrderDetailWorkflow,
  createOrderFulfillmentWorkflow,
  createOrUpdateOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
  beginReturnOrderWorkflow,
  beginReceiveReturnWorkflow,
  confirmReturnRequestWorkflow,
  refundPaymentsWorkflow,
} from "@medusajs/core-flows"

import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  createStockLocationsWorkflow,
  createInventoryLevelsWorkflow,
  createShippingProfilesWorkflow,
  createShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

export default async function seedTwoOrders({ container }: ExecArgs) {
  const { faker } = await import("@faker-js/faker")
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  // Ensure a customer exists
  let { data: customers } = (await query.graph({
    entity: "customer",
    fields: ["id", "email"],
  })) as { data: Array<{ id: string; email: string }> }

  if (!customers.length) {
    logger.info("No customers found. Creating a new customer...")
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    const email = faker.internet
      .email({ firstName, lastName, provider: "example.com" })
      .toLowerCase()

    await createCustomersWorkflow(container).run({
      input: { customersData: [{ first_name: firstName, last_name: lastName, email }] },
    })

    const requery = (await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email },
    })) as { data: Array<{ id: string; email: string }> }
    customers = requery.data?.length ? requery.data : customers
    logger.info(`Created customer: ${email}`)
  }

  // Fetch region / products / shipping options
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  const { data: products } = (await query.graph({
    entity: "product",
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
  }

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
  })) as { data: Array<{ id: string; name: string }> }

  if (!products.length) {
    logger.warn("No products found. Please seed products first.")
    return
  }

  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  })

  // Ensure stock location, inventory, and a shipping option
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)

  let { data: stock_locations } = (await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })) as { data: Array<{ id: string; name: string }> }

  if (!stock_locations.length) {
    const { result: locs } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "European Warehouse",
            address: { city: "Copenhagen", country_code: "DK", address_1: "" },
          },
        ],
      },
    })
    stock_locations = locs
  }
  const stockLocationId = stock_locations[0].id

  if (defaultSalesChannel?.[0]?.id) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocationId, add: [defaultSalesChannel[0].id] },
    })
  }

  const { data: inventoryItems } = (await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  })) as { data: Array<{ id: string }> }

  const { data: existingLevels } = (await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id"],
    filters: { location_id: stockLocationId },
  })) as { data: Array<{ inventory_item_id: string }> }

  const existingSet = new Set(existingLevels.map((l) => l.inventory_item_id))
  const levelsToCreate = inventoryItems
    .filter((ii) => !existingSet.has(ii.id))
    .map((ii) => ({ location_id: stockLocationId, stocked_quantity: 1_000_000, inventory_item_id: ii.id }))

  if (levelsToCreate.length) {
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: levelsToCreate } })
  }

  if (!shipping_options.length) {
    const profiles = await fulfillmentModuleService.listShippingProfiles({ type: "default" })
    let shippingProfile = profiles[0]
    if (!shippingProfile) {
      const { result: profs } = await createShippingProfilesWorkflow(container).run({
        input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
      })
      shippingProfile = profs[0]
    }

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

    const soRe = (await query.graph({ entity: "shipping_option", fields: ["id", "name"] })) as {
      data: Array<{ id: string; name: string }>
    }
    shipping_options = soRe.data
  }

  // Deterministic picks
  const region = regions[0]
  const customer = customers[0]
  const shipping_option = shipping_options[0]

  const pickVariantWithPrice = () => {
    for (const p of products) {
      const v = p.variants?.[0]
      if (!v) continue
      const price = v.prices?.find((pr) => pr.currency_code === region.currency_code)?.amount || v.prices?.[0]?.amount
      if (price) {
        return { productTitle: p.title, variantId: v.id, unitPrice: price }
      }
    }
    const p0 = products[0]
    const v0 = p0.variants![0]
    const price0 = v0.prices?.[0]?.amount || 2500
    return { productTitle: p0.title, variantId: v0.id, unitPrice: price0 }
  }

  const baseAddress = {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    phone: faker.phone.number(),
    company: faker.company.name(),
    address_1: faker.location.streetAddress(),
    address_2: faker.location.secondaryAddress(),
    city: faker.location.city(),
    country_code: (Array.isArray(region.countries) && region.countries[0]?.iso_2?.toLowerCase()) || "de",
    province: faker.location.state(),
    postal_code: faker.location.zipCode(),
    metadata: {},
  }

  const makeOrderInput = () => {
    const line = pickVariantWithPrice()
    return {
      email: customer.email,
      customer_id: customer.id,
      region_id: region.id,
      currency_code: region.currency_code,
      sales_channel_id: defaultSalesChannel?.[0]?.id,
      shipping_address: baseAddress,
      billing_address: baseAddress,
      items: [
        { title: line.productTitle, unit_price: line.unitPrice, variant_id: line.variantId, quantity: 1 },
      ],
      shipping_methods: [
        { option_id: shipping_option.id, name: shipping_option.name, amount: 10, data: {} },
      ],
      metadata: {},
    }
  }

  async function backdateOrder(orderId: string) {
    try {
      const dbUrl = process.env.DATABASE_URL || ""
      if (!dbUrl.startsWith("postgres")) return
      const now = new Date()
      const start = new Date(now)
      start.setDate(start.getDate() - 14)
      const offsetDays = Math.floor(Math.random() * 14)
      const backdated = new Date(start)
      backdated.setDate(start.getDate() + offsetDays)

      const pg = new PgClient({ connectionString: dbUrl })
      await pg.connect()
      try {
        const candidates = ['"order"', "orders", "order_order"]
        for (const table of candidates) {
          const res = await pg.query(
            `update ${table} set created_at = $1, updated_at = case when updated_at < $1 then $1 else updated_at end where id = $2`,
            [backdated.toISOString(), orderId]
          )
          if (res.rowCount) break
        }
      } finally {
        await pg.end().catch(() => {})
      }
    } catch {}
  }

  async function ensurePaid(orderId: string, totalFallback?: number) {
    const { result: detail } = await getOrderDetailWorkflow(container).run({
      input: { order_id: orderId, fields: ["id", "total", "payment_status", "payment_collections.id"] },
    })

    let paymentCollectionId = detail.payment_collections?.[0]?.id
    if (!paymentCollectionId) {
      const { result: pcs } = await createOrUpdateOrderPaymentCollectionWorkflow(container).run({
        input: { order_id: orderId, amount: Math.round(Number(detail.total || totalFallback || 0)) },
      })
      paymentCollectionId = pcs?.[0]?.id
    }

    if (paymentCollectionId) {
      await markPaymentCollectionAsPaid(container).run({
        input: { order_id: orderId, payment_collection_id: paymentCollectionId },
      })
    }
  }

  // PATCHED: get items + shipping_method, and pass stockLocationId
  async function fulfillAll(orderId: string, stockLocationId?: string) {
    const { data: orders } = (await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.quantity", "shipping_methods.id"],
      filters: { id: orderId },
    })) as {
      data: Array<{ id: string; items: Array<{ id: string; quantity: number }>; shipping_methods: Array<{ id: string }> }>
    }

    const ord = orders?.[0]
    const items = (ord?.items || [])
      .filter((it) => it?.id && it?.quantity)
      .map((it) => ({ id: it.id, quantity: it.quantity }))

    if (!items.length) {
      logger.warn(`No items to fulfill for order ${orderId}`)
      return
    }

    const shippingMethodId = ord?.shipping_methods?.[0]?.id

    await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: orderId,
        items,
        ...(stockLocationId ? { location_id: stockLocationId } : {}),
        ...(shippingMethodId ? { shipping_method_id: shippingMethodId } : {}),
      },
    })
  }

  async function returnAndRefund(orderId: string) {
    const { result: detail } = await getOrderDetailWorkflow(container).run({
      input: {
        order_id: orderId,
        fields: [
          "id",
          "total",
          "items.id",
          "items.quantity",
          "payment_collections.id",
          "payment_collections.payments.id",
        ],
      },
    })

    const firstItem = detail.items?.[0]
    if (!firstItem) {
      logger.warn(`Order ${orderId} has no items to return.`)
      return
    }

    await beginReturnOrderWorkflow(container).run({ input: { order_id: orderId } })

    const { data: returns } = (await query.graph({
      entity: "return",
      fields: ["id", "status", "order_id"],
      filters: { order_id: orderId },
    })) as { data: Array<{ id: string; status: string; order_id: string }> }

    const ret = returns?.[returns.length - 1]
    if (!ret?.id) {
      logger.warn(`Could not locate created return for order ${orderId}.`)
      return
    }

    await beginReceiveReturnWorkflow(container).run({
      input: { return_id: ret.id, description: "Seed script: receiving returned item(s)" },
    })

    await confirmReturnRequestWorkflow(container).run({ input: { return_id: ret.id } as any })

    const payments = detail.payment_collections?.[0]?.payments || ([] as Array<{ id: string }>)
    if (payments.length) {
      await refundPaymentsWorkflow(container).run({
        input: payments.map((p) => ({ payment_id: p.id })),
      })
    } else {
      logger.warn(`No payments linked on order ${orderId}; cannot refund.`)
    }
  }

  // Create Order A → pay → fulfill
  try {
    const orderInputA = makeOrderInput()
    const { result: orderA } = await createOrderWorkflow(container).run({ input: orderInputA })
    logger.info(`Created Order A: ${orderA.id}`)

    await backdateOrder(orderA.id)
    await ensurePaid(orderA.id, 0)
    await fulfillAll(orderA.id, stockLocationId)
    logger.info(`Order A paid & fulfilled.`)
  } catch (e: any) {
    logger.error(`Failed Order A flow: ${e?.message ?? e}`)
    return
  }

  // Create Order B → pay → fulfill → return & refund
  try {
    const orderInputB = makeOrderInput()
    const { result: orderB } = await createOrderWorkflow(container).run({ input: orderInputB })
    logger.info(`Created Order B: ${orderB.id}`)

    await backdateOrder(orderB.id)
    await ensurePaid(orderB.id, 0)
    await fulfillAll(orderB.id, stockLocationId)
    logger.info(`Order B paid & fulfilled.`)

    await returnAndRefund(orderB.id)
    logger.info(`Order B returned & refunded.`)
  } catch (e: any) {
    logger.error(`Failed Order B flow: ${e?.message ?? e}`)
    return
  }

  logger.info("✅ Done: created 2 demo orders (A fulfilled, B returned & refunded).")
}
