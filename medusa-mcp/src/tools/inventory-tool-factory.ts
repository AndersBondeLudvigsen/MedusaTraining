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

  return [low_inventory_products_count];
}

