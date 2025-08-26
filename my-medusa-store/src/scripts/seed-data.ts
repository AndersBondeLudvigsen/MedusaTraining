// src/scripts/seed-data.ts -- FINAL v2 VERSION

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

export default async function ({ container }): Promise<void> {
  console.log("🚀 Starting data seeding...");
  
  // Seed Regions - NOTE THE NEW SERVICE NAME: `regionModuleService`
  const regionService = container.resolve("regionModuleService");
  for (const regionData of seedData.regions) {
      const existing = await regionService.list({ name: regionData.name });
      if (!existing.length) {
          await regionService.create(regionData);
      }
  }
  console.log("🌱 Regions seeded.");

  // Seed Products - NOTE THE NEW SERVICE NAME: `productModuleService`
  const productService = container.resolve("productModuleService");
  for (const productData of seedData.products) {
      const existing = await productService.list({ handle: productData.handle });
      if (!existing.length) {
          await productService.create(productData);
      }
  }
  console.log("🌱 Products seeded.");
  
  // Seed Users
  const userService = container.resolve("userService");
  for (const userData of seedData.users) {
      const existing = await userService.list({ email: userData.email });
      if (!existing.length) {
          await userService.create(userData, userData.password);
      }
  }
  console.log("🌱 Users seeded.");

  console.log("✅ Data seeding complete!");
}