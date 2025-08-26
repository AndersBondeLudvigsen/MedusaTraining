// src/scripts/demo-products.ts -- FINAL CORRECTED VERSION

import { createProductsWorkflow, createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { Modules, ContainerRegistrationKeys, ProductStatus } from "@medusajs/utils"

export default async function seedDummyProducts({ container }) {
  const { faker } = await import("@faker-js/faker");

  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const defaultSalesChannel = await salesChannelModuleService.listSalesChannels({ name: "Default Sales Channel" })
  const currency_code = "eur"

  // Batch 1: Clothing Items
  const clothingSizeOptions = ["S", "M", "L", "XL"]
  const clothingColorOptions = ["Black", "White"]
  const clothingProductsData = new Array(50).fill(0).map((_, index) => {
    const title = faker.commerce.productName() + "_clothing_" + index
    return {
      title,
      is_giftcard: false,
      description: faker.commerce.productDescription(),
      status: ProductStatus.PUBLISHED,
      options: [
        { title: "Size", values: clothingSizeOptions },
        { title: "Color", values: clothingColorOptions },
      ],
      images: [ { url: faker.image.url() } ],
      variants: clothingSizeOptions.flatMap(size => clothingColorOptions.map(color => ({
        title: `${size} / ${color}`,
        sku: `${title.slice(0, 5)}-${size}-${color}-${index}`,
        prices: [{ currency_code, amount: faker.number.int({ min: 1000, max: 5000 }) }],
        options: { "Size": size, "Color": color },
      }))),
      sales_channels: [{ id: defaultSalesChannel[0].id }],
    }
  })

  // Batch 2: Electronic Gadgets
  const gadgetStorageOptions = ["64GB", "128GB", "256GB"]
  const gadgetColorOptions = ["Space Gray", "Silver"]
  const electronicProductsData = new Array(30).fill(0).map((_, index) => {
    const title = faker.commerce.productName() + "_gadget_" + index
    return {
      title,
      is_giftcard: false,
      description: faker.commerce.productDescription(),
      status: ProductStatus.PUBLISHED,
      options: [
        { title: "Storage", values: gadgetStorageOptions },
        { title: "Color", values: gadgetColorOptions },
      ],
      images: [ { url: faker.image.url() } ],
      variants: gadgetStorageOptions.flatMap(storage => gadgetColorOptions.map(color => ({
        title: `${storage} / ${color}`,
        sku: `${title.slice(0, 5)}-${storage}-${color}-${index}`,
        prices: [{ currency_code, amount: faker.number.int({ min: 10000, max: 50000 }) }],
        options: { "Storage": storage, "Color": color },
      }))),
      sales_channels: [{ id: defaultSalesChannel[0].id }],
    }
  })
  
  const allProductsData = [...clothingProductsData, ...electronicProductsData];

  const productService = container.resolve(Modules.PRODUCT);
  
  const productsToCreate = [];
  for (const productData of allProductsData) {
    const handle = productData.title.toLowerCase().replace(/ /g, "-").replace(/_/g, "-");
    // CORRECTED: The method is now `listProducts` instead of `list`.
    const existing = await productService.listProducts({ handle: handle });
    if (!existing.length) {
      productsToCreate.push(productData);
    }
  }

  if (productsToCreate.length > 0) {
    await createProductsWorkflow(container).run({
      input: { products: productsToCreate },
    });
    logger.info(`Seeded ${productsToCreate.length} new products.`);
  } else {
    logger.info("No new products to seed.");
  }


  logger.info("Checking for inventory levels to seed...");
  const { data: stockLocations } = await query.graph({ entity: "stock_location", fields: ["id"] })

  if (!stockLocations?.length) {
    logger.warn("No stock locations found. Skipping inventory seeding.");
    return;
  }
  const defaultLocationId = stockLocations[0].id;
  
  const { data: existingLevels } = await query.graph({ 
    entity: "inventory_level", 
    fields: ["inventory_item_id"],
    filter: { location_id: defaultLocationId }
  });
  const existingItemIds = new Set(existingLevels.map(level => level.inventory_item_id));

  const { data: allInventoryItems } = await query.graph({ entity: "inventory_item", fields: ["id"] });
  
  const itemsToStock = allInventoryItems.filter(item => !existingItemIds.has(item.id));
  
  if (!itemsToStock.length) {
    logger.info("All items are already stocked. Nothing to do.");
    return;
  }
  
  const inventoryLevelsToCreate = itemsToStock.map((inventoryItem) => ({
    location_id: defaultLocationId,
    stocked_quantity: 100,
    inventory_item_id: inventoryItem.id,
  }));
  
  await createInventoryLevelsWorkflow(container).run({
    input: { inventory_levels: inventoryLevelsToCreate },
  });
  logger.info(`Created inventory levels for ${inventoryLevelsToCreate.length} new items.`);
}