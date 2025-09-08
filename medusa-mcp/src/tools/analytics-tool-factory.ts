import { defineTool } from "../utils/define-tools";

type AnalyticsService = {
  ordersCount: (start: string, end: string) => Promise<number>;
  salesAggregate: (params: {
    start: string;
    end: string;
    group_by: "product" | "variant";
    metric: "quantity" | "revenue" | "orders";
    limit?: number;
    sort?: "asc" | "desc";
  }) => Promise<
    Array<{
      product_id: string | null;
      variant_id: string | null;
      sku: string | null;
      title: string | null;
      quantity: number;
      revenue: number;
      orders: number;
      value: number;
    }>
  >;
};

export function createAnalyticsTools(analytics: AnalyticsService) {
  // alias coercers
  const coerceRange = (input: Record<string, unknown>) => {
    const s =
      (input.start as string | undefined) ||
      (input.start_date as string | undefined) ||
      (input.from as string | undefined);
    const e =
      (input.end as string | undefined) ||
      (input.end_date as string | undefined) ||
      (input.to as string | undefined);
    return { start: s, end: e };
  };

  const coerceGroupBy = (
    input: Record<string, unknown>
  ): "product" | "variant" | undefined => {
    const raw =
      (input.group_by as string | undefined) ||
      (input.grouping as string | undefined) ||
      (input.group as string | undefined) ||
      (input.groupby as string | undefined);
    if (!raw) return undefined;
    const v = String(raw).toLowerCase().trim();
    if (v.startsWith("product")) return "product";
    if (v.startsWith("variant")) return "variant";
    return undefined;
  };

  const coerceMetric = (
    input: Record<string, unknown>
  ): "quantity" | "revenue" | "orders" | undefined => {
    const raw =
      (input.metric as string | undefined) ||
      (input.measure as string | undefined) ||
      (input.by as string | undefined) ||
      (input.agg as string | undefined) ||
      (input.aggregate as string | undefined);
    if (!raw) return undefined;
    const v = String(raw).toLowerCase().trim();
    if (["quantity", "qty", "units", "unit"].includes(v)) return "quantity";
    if (["orders", "order", "order_count", "num_orders"].includes(v)) return "orders";
    if (["revenue", "sales", "amount", "gmv", "turnover"].includes(v)) return "revenue";
    return undefined;
  };

  const orders_count = defineTool((z) => ({
    name: "orders_count",
    description:
      "Count non-canceled orders in a UTC date range [start, end). Returns { count }.",
    inputSchema: {
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const { start, end } = coerceRange(input);
      if (!start || !end) {
        throw new Error(
          "Missing required range. Provide (start,end) or (start_date,end_date) or (from,to) as ISO date-times."
        );
      }
      const schema = z.object({ start: z.string().datetime(), end: z.string().datetime() });
      const parsed = schema.safeParse({ start, end });
      if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);
      const count = await analytics.ordersCount(start, end);
      return { start, end, count };
    },
  }));

  const sales_aggregate = defineTool((z) => ({
    name: "sales_aggregate",
    description:
      "Aggregate sales in a UTC date range with grouping and metric. Returns actable IDs.",
    inputSchema: {
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),

      group_by: z.union([z.literal("product"), z.literal("variant")]).optional(),
      grouping: z.string().optional(),
      group: z.string().optional(),
      groupby: z.string().optional(),

      metric: z.union([z.literal("quantity"), z.literal("revenue"), z.literal("orders")]).optional(),
      measure: z.string().optional(),
      by: z.string().optional(),
      agg: z.string().optional(),
      aggregate: z.string().optional(),

      limit: z.number().int().min(1).max(50).default(5),
      sort: z.union([z.literal("desc"), z.literal("asc")]).default("desc"),
    },
    handler: async (input: Record<string, unknown>): Promise<unknown> => {
      const rng = coerceRange(input);
      if (!rng.start || !rng.end) {
        throw new Error(
          "Missing required range. Provide (start,end) or (start_date,end_date) or (from,to) as ISO date-times."
        );
      }

      const group_by = coerceGroupBy(input);
      const metric = coerceMetric(input);
      if (!group_by) throw new Error("Missing or invalid grouping. Use 'group_by' (or 'grouping') with 'product'/'product_id' or 'variant'/'variant_id'.");
      if (!metric) throw new Error("Missing or invalid metric. Use 'metric' (or 'measure') with 'quantity'|'revenue'|'orders'.");

      const limit =
        typeof input.limit === "number" && Number.isInteger(input.limit)
          ? Math.max(1, Math.min(50, input.limit))
          : 5;
      const sort = (String(input.sort ?? "desc").toLowerCase() === "asc" ? "asc" : "desc") as
        | "asc"
        | "desc";

      const schema = z.object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        group_by: z.union([z.literal("product"), z.literal("variant")]),
        metric: z.union([z.literal("quantity"), z.literal("revenue"), z.literal("orders")]),
        limit: z.number().int().min(1).max(50),
        sort: z.union([z.literal("desc"), z.literal("asc")]),
      });
      const parsed = schema.safeParse({
        start: rng.start,
        end: rng.end,
        group_by,
        metric,
        limit,
        sort,
      });
      if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.message}`);

      const rows = await analytics.salesAggregate({
        start: parsed.data.start,
        end: parsed.data.end,
        group_by: parsed.data.group_by,
        metric: parsed.data.metric,
        limit: parsed.data.limit,
        sort: parsed.data.sort,
      });

      return {
        start: parsed.data.start,
        end: parsed.data.end,
        group_by: parsed.data.group_by,
        metric: parsed.data.metric,
        results: rows,
        xKey: "rank",
        yKey: "value",
        title: `Top ${parsed.data.group_by}s by ${parsed.data.metric}`,
      };
    },
  }));

  return [orders_count, sales_aggregate];
}
