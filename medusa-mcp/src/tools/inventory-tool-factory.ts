import { defineTool } from "../utils/define-tools";

type InventoryService = {
  countLowInventoryProducts: (params: {
    threshold: number;
    manage_inventory_only?: boolean;
  }) => Promise<{
    threshold: number;
    count: number;
    variants_count: number;
  }>;
  listLowInventoryProducts: (params: {
    threshold: number;
    manage_inventory_only?: boolean;
  }) => Promise<{
    threshold: number;
    count: number;
    variants_count: number;
    products: Array<{
      id: string;
      title: string | null;
      low_variants_count: number;
      low_variants: Array<{
        id: string;
        title: string | null;
        sku: string | null;
        inventory_quantity: number;
      }>;
    }>;
  }>;
};

export function createInventoryTools(
  inventory: InventoryService
): Array<ReturnType<typeof defineTool>> {
  const low_inventory_products_count = defineTool((z) => ({
    name: "low_inventory_products_count",
    description:
      "Count distinct products that have at least one variant with inventory below a threshold. Defaults to manage_inventory=true. Returns { threshold, count, variants_count }.",
    inputSchema: {
      threshold: z
        .number()
        .int()
        .min(0)
        .describe("Inventory threshold (e.g., 100, 50, 200)"),
      manage_inventory_only: z
        .boolean()
        .optional()
        .describe(
          "If true, only consider variants where manage_inventory is enabled (default true)."
        ),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const schema = z.object({
        threshold: z.number().int().min(0),
        manage_inventory_only: z.boolean().optional(),
      });
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid input: ${parsed.error.message}`);
      }

      const res = await inventory.countLowInventoryProducts({
        threshold: parsed.data.threshold,
        manage_inventory_only: parsed.data.manage_inventory_only,
      });
      return res;
    },
  }));

  const low_inventory_products_list = defineTool((z) => ({
    name: "low_inventory_products_list",
    description:
      "List products that have at least one variant with inventory below a threshold. Returns product id, title, and low variants (id, title, sku, quantity).",
    inputSchema: {
      threshold: z
        .number()
        .int()
        .min(0)
        .describe("Inventory threshold (e.g., 100, 50, 200)"),
      manage_inventory_only: z
        .boolean()
        .optional()
        .describe(
          "If true, only consider variants where manage_inventory is enabled (default true)."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Maximum number of products to return (default 50)."),
      include_variants: z
        .boolean()
        .optional()
        .describe(
          "Whether to include detailed low variants per product (default true)."
        ),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const schema = z.object({
        threshold: z.number().int().min(0),
        manage_inventory_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        include_variants: z.boolean().optional(),
      });
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid input: ${parsed.error.message}`);
      }

      const res = await inventory.listLowInventoryProducts({
        threshold: parsed.data.threshold,
        manage_inventory_only: parsed.data.manage_inventory_only,
      });

      // Sort by number of low variants desc
      const sorted = [...res.products].sort(
        (a, b) => b.low_variants_count - a.low_variants_count
      );
      const limit = parsed.data.limit ?? 50;
      const includeVariants = parsed.data.include_variants ?? true;
      const limited = sorted.slice(0, limit);

      const products = includeVariants
        ? limited
        : limited.map((p) => ({
            id: p.id,
            title: p.title,
            low_variants_count: p.low_variants_count,
          }));

      return {
        threshold: res.threshold,
        count: res.count,
        variants_count: res.variants_count,
        products,
      };
    },
  }));

  return [low_inventory_products_count, low_inventory_products_list];
}
