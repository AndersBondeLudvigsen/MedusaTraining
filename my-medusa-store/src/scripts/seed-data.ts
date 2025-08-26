// src/scripts/seed-data.ts — v2-compatible seeder (regions + products)

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { createRegionsWorkflow, createProductsWorkflow } from "@medusajs/medusa/core-flows"

const seedData = {
  products: [
    {
      title: "Classic Denim Jeans",
      subtitle: "Comfortable and built to last",
      description: "A timeless pair of straight-leg denim jeans, perfect for any occasion. Made from high-quality, durable cotton with a classic five-pocket design.",
      handle: "classic-denim-jeans",
      is_giftcard: false,
      discountable: true,
      images: [
        "https://medusa-public-images.s3.eu-west-1.amazonaws.com/jeans-front.png",
        "https://medusa-public-images.s3.eu-west-1.amazonaws.com/jeans-back.png"
      ],
      options: [
        { title: "Size" },
        { title: "Color" }
      ],
      variants: [
        {
          title: "Small / Blue",
          prices: [
            { currency_code: "usd", amount: 6000 },
            { currency_code: "eur", amount: 5500 }
          ],
          options: [{ value: "S" }, { value: "Blue" }]
        },
        {
          title: "Medium / Blue",
          prices: [
            { currency_code: "usd", amount: 6000 },
            { currency_code: "eur", amount: 5500 }
          ],
          options: [{ value: "M" }, { value: "Blue" }]
        },
        {
          title: "Large / Black",
          prices: [
            { currency_code: "usd", amount: 6000 },
            { currency_code: "eur", amount: 5500 }
          ],
          options: [{ value: "L" }, { value: "Black" }]
        }
      ],
      type: { value: "Pants" },
      tags: [{ value: "Denim" }, { value: "Classic" }]
    },
    {
      title: "Vintage Leather Jacket",
      subtitle: "Iconic and effortlessly cool",
      description: "A stylish and durable vintage leather jacket. Features a classic collar, zip-front closure, and multiple pockets. Perfect for adding an edge to any outfit.",
      handle: "vintage-leather-jacket",
      is_giftcard: false,
      discountable: true,
      images: [
        "https://medusa-public-images.s3.eu-west-1.amazonaws.com/leather-jacket-front.png"
      ],
      options: [{ title: "Size" }],
      variants: [
        {
          title: "Medium",
          prices: [
            { currency_code: "usd", amount: 15000 },
            { currency_code: "eur", amount: 13500 }
          ],
          options: [{ value: "M" }]
        },
        {
          title: "Large",
          prices: [
            { currency_code: "usd", amount: 15000 },
            { currency_code: "eur", amount: 13500 }
          ],
          options: [{ value: "L" }]
        },
        {
          title: "Extra Large",
          prices: [
            { currency_code: "usd", amount: 15500 },
            { currency_code: "eur", amount: 14000 }
          ],
          options: [{ value: "XL" }]
        }
      ],
      type: { value: "Jacket" },
      tags: [{ value: "Leather" }, { value: "Vintage" }]
    }
  ],
  regions: [
    {
      name: "North America",
      currency_code: "usd",
      tax_rate: 0,
      countries: ["us", "ca"]
    },
    {
      name: "Europe",
      currency_code: "eur",
      tax_rate: 0,
      countries: ["gb", "de", "fr", "it", "es", "dk", "se", "no"]
    }
  ],
  users: [
    {
      email: "admin@medusa-test.com",
      first_name: "Admin",
      last_name: "User",
      password: "supersecret"
    }
  ]
};

export default async function runSeed({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const productModuleService = container.resolve(Modules.PRODUCT)
  const regionModuleService = container.resolve(Modules.REGION)

  logger.info("🚀 Starting data seeding...")

  // Resolve default sales channel (used when creating products)
  const defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  })

  // Seed Regions using workflow (idempotent check via module service)
  for (const regionData of seedData.regions) {
    const existingRegions = await regionModuleService.listRegions({ name: regionData.name })

    if (!existingRegions?.length) {
      await createRegionsWorkflow(container).run({
        input: {
          regions: [
            {
              name: regionData.name,
              currency_code: regionData.currency_code,
              countries: regionData.countries,
              // Use system default payment provider
              payment_providers: ["pp_system_default"],
            },
          ],
        },
      })
      logger.info(`Created region: ${regionData.name}`)
    }
  }
  logger.info("🌱 Regions seeded.")

  // Helper: transform product seed into createProductsWorkflow input
  const toWorkflowProduct = (p: any) => {
    // Derive option values from variants if not provided
    const optionTitles: string[] = (p.options || []).map((o) => o.title)

  const optionValuesMap: { [key: string]: Set<string> } = {}
    optionTitles.forEach((t) => (optionValuesMap[t] = new Set()))

    for (const v of p.variants || []) {
      (v.options || []).forEach((ov: any, idx: number) => {
        const title = optionTitles[idx]
        if (title && ov?.value != null) {
          optionValuesMap[title].add(String(ov.value))
        }
      })
    }

    const options = optionTitles.map((title) => ({
      title,
      values: Array.from(optionValuesMap[title] || []),
    }))

    const variants = (p.variants || []).map((v: any) => {
      const variantOptions = Object.create(null) as Record<string, string>
      (v.options || []).forEach((ov: any, idx: number) => {
        const title = optionTitles[idx]
        if (title && ov?.value != null) {
          variantOptions[title] = String(ov.value)
        }
      })

      return {
        title: v.title,
        options: variantOptions,
        prices: v.prices,
      }
    })

    return {
      title: p.title,
      subtitle: p.subtitle,
      description: p.description,
      handle: p.handle,
      is_giftcard: !!p.is_giftcard,
      discountable: !!p.discountable,
      status: ProductStatus.PUBLISHED,
      images: (p.images || []).map((url: string) => ({ url })),
      options,
      variants,
      // Link to default sales channel if available
      sales_channels: defaultSalesChannel?.length
        ? [{ id: defaultSalesChannel[0].id }]
        : [],
      // type/tags can be added via additional workflows if needed
    }
  }

  // Collect products that don't exist yet
  const productsToCreate: any[] = []
  for (const productData of seedData.products) {
    const existingProducts = await productModuleService.listProducts({ handle: productData.handle })

    if (!existingProducts?.length) {
      productsToCreate.push(toWorkflowProduct(productData))
    }
  }

  if (productsToCreate.length) {
    await createProductsWorkflow(container).run({
      input: { products: productsToCreate },
    })
    logger.info(`Created ${productsToCreate.length} product(s).`)
  }
  logger.info("🌱 Products seeded.")

  // Seed Users (best-effort): APIs vary; skip gracefully if not supported
  try {
    const userService: any = container.resolve("user")
    for (const userData of seedData.users) {
      let existing: any[] = []
      if (typeof userService.listUsers === "function") {
        existing = await userService.listUsers({ email: userData.email })
      } else if (typeof userService.list === "function") {
        existing = await userService.list({ email: userData.email })
      }

      if (!existing?.length) {
        if (typeof userService.createUsers === "function") {
          await userService.createUsers([
            {
              email: userData.email,
              first_name: userData.first_name,
              last_name: userData.last_name,
            },
          ])
          logger.info(`Created user: ${userData.email} (password setup may be required)`)        
        } else {
          logger.warn("User creation API not available. Skipping user seeding.")
          break
        }
      }
    }
    logger.info("🌱 Users seeded (best-effort).")
  } catch (e) {
    logger.warn("Skipping user seeding (module not available or incompatible).")
  }

  logger.info("✅ Data seeding complete!")
}