import Medusa from "@medusajs/js-sdk";
import { config } from "dotenv";
import { ZodTypeAny } from "zod";
import adminJson from "../oas/admin.json";
import { SdkRequestType, Parameter } from "../types/admin-json";
import { defineTool } from "../utils/define-tools";

config();

const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000";

const MEDUSA_USERNAME = process.env.MEDUSA_USERNAME ?? "medusa_user";
const MEDUSA_PASSWORD = process.env.MEDUSA_PASSWORD ?? "medusa_pass";

type AdminVariantMaybe = {
  id?: string;
  product_id?: string;
  product?: { id?: string; title?: string } | null;
  sku?: string | null;
  title?: string | null;
};

type AdminOrderItemMaybe = {
  id?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
  title?: string | null;
  sku?: string | null;
  variant_id?: string | null;
  product_id?: string | null; // some setups include this
  variant?: AdminVariantMaybe | null; // when expanded/detail
};

type AdminOrderMinimal = {
  id?: string;
  created_at?: string;
  canceled_at?: string | null;
  items?: AdminOrderItemMaybe[]; // present on detail; sometimes on list depending on setup
};

type VariantResolution = {
  product_id?: string;
  title?: string | null;
  sku?: string | null;
};

export default class MedusaAdminService {
  sdk: Medusa;
  adminToken = "";

  private variantToProductCache = new Map<string, VariantResolution>();

  constructor() {
    this.sdk = new Medusa({
      baseUrl: MEDUSA_BACKEND_URL,
      debug: process.env.NODE_ENV === "development",
      publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
      auth: { type: "jwt" },
    });
  }

  async init(): Promise<void> {
    const res = (await this.sdk.auth.login("user", "emailpass", {
      email: MEDUSA_USERNAME,
      password: MEDUSA_PASSWORD,
    })) as any;

    const token =
      res?.token ?? res?.access_token ?? res?.jwt ?? res?.toString?.();
    if (typeof token === "string" && token && token !== "[object Object]") {
      this.adminToken = token;
    } else {
      this.adminToken = "";
    }
  }

  /** Flatten object into bracket-notation query pairs (supports nested objects). */
  private toBracketParams(
    obj: Record<string, unknown>,
    prefix = ""
  ): [string, string][] {
    const out: [string, string][] = [];
    const push = (k: string, v: unknown) => {
      if (v === undefined || v === null) return;
      out.push([k, String(v)]);
    };

    for (const [key, value] of Object.entries(obj)) {
      const k = prefix ? `${prefix}[${key}]` : key;

      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        for (const v of value) push(k, v);
      } else if (typeof value === "object") {
        out.push(...this.toBracketParams(value as Record<string, unknown>, k));
      } else {
        push(k, value);
      }
    }
    return out;
  }

  private withQuery(path: string, queryObj: Record<string, unknown>): string {
    const pairs = this.toBracketParams(queryObj);
    if (pairs.length === 0) return path;
    const qs = new URLSearchParams(pairs).toString();
    return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
  }

  /** Authenticated GET (appends query directly on the URL). */
  private async adminGet<T = unknown>(
    path: string,
    queryObj: Record<string, unknown> = {}
  ): Promise<T> {
    const finalPath = this.withQuery(path, queryObj);
    const res = await this.sdk.client.fetch(finalPath, {
      method: "get",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.adminToken
          ? { Authorization: `Bearer ${this.adminToken}` }
          : {}),
      },
    });
    return res as T;
  }

  // ---------- Time helpers ----------

  private inRangeUtc(iso: string, fromIso: string, toIso: string): boolean {
    const t = Date.parse(iso);
    return t >= Date.parse(fromIso) && t < Date.parse(toIso);
  }

  /**
   * Fetch ALL orders in [fromIso, toIso) (paged). We double-check client-side by created_at
   * for correctness and exclude orders with canceled_at set.
   */
  private async fetchOrdersInRange(
    fromIso: string,
    toIso: string
  ): Promise<AdminOrderMinimal[]> {
    const limit = 200;
    let offset = 0;
    const acc: AdminOrderMinimal[] = [];

    const baseQuery = {
      created_at: { gte: fromIso, lt: toIso },
    } as const;

    while (true) {
      const q = { ...baseQuery, limit, offset };
      const data = await this.adminGet<{ orders?: AdminOrderMinimal[] }>(
        "/admin/orders",
        q
      );

      const batch = Array.isArray(data?.orders) ? data.orders : [];
      if (batch.length === 0) break;

      for (const o of batch) {
        if (!o?.created_at) continue;
        if (o?.canceled_at) continue; // exclude canceled
        if (this.inRangeUtc(o.created_at, fromIso, toIso)) {
          acc.push({
            id: o.id,
            created_at: o.created_at,
            canceled_at: o.canceled_at,
            items: o.items, // may be undefined on v2 list
          });
        }
      }

      if (batch.length < limit) break;
      offset += limit;
    }

    return acc;
  }

  /** Count orders in [fromIso, toIso) using client-side filtered list. */
  private async countOrdersInRange(
    fromIso: string,
    toIso: string
  ): Promise<number> {
    const orders = await this.fetchOrdersInRange(fromIso, toIso);
    return orders.length;
  }

  /**
   * Fetch orders with items present. v2 may not allow `expand` on list responses, so:
   *  - list orders (no expand)
   *  - for any order missing `items`, retrieve the order detail `/admin/orders/{id}`
   *    to get `items` (and possibly variant/product info).
   */
  private async fetchOrdersWithItemsInRange(
    fromIso: string,
    toIso: string
  ): Promise<AdminOrderMinimal[]> {
    const list = await this.fetchOrdersInRange(fromIso, toIso);
    const acc: AdminOrderMinimal[] = [];

    for (const o of list) {
      if (Array.isArray(o.items) && o.items.length > 0) {
        acc.push(o);
        continue;
      }
      if (!o.id) continue;

      // Retrieve detail for items
      try {
        const detail = await this.adminGet<{ order?: AdminOrderMinimal }>(
          `/admin/orders/${encodeURIComponent(o.id)}`
        );
        const full = detail?.order ?? {};
        acc.push({
          id: o.id,
          created_at: o.created_at,
          canceled_at: o.canceled_at,
          items: Array.isArray(full.items) ? full.items : [],
        });
      } catch {
        // If detail fails, fall back to no items (ignored in aggregation)
        acc.push({ ...o, items: [] });
      }
    }

    return acc;
  }

  // ---------- Variant -> Product resolution cache ----------

  private clearVariantCache() {
    this.variantToProductCache.clear();
  }

  private async resolveProductFromVariant(
    variantId: string
  ): Promise<VariantResolution> {
    if (this.variantToProductCache.has(variantId)) {
      return this.variantToProductCache.get(variantId)!;
    }

    try {
      const r = await this.adminGet<{
        variant?: {
          product_id?: string;
          product?: { id?: string; title?: string } | null;
          title?: string | null;
          sku?: string | null;
        };
      }>(`/admin/variants/${encodeURIComponent(variantId)}`);

      const v = r?.variant ?? {};
      const entry: VariantResolution = {
        product_id: v?.product_id ?? v?.product?.id,
        title: v?.product?.title ?? v?.title ?? null,
        sku: v?.sku ?? null,
      };

      this.variantToProductCache.set(variantId, entry);
      return entry;
    } catch {
      const entry: VariantResolution = {
        product_id: undefined,
        title: null,
        sku: null,
      };
      this.variantToProductCache.set(variantId, entry);
      return entry;
    }
  }

  // ---------- Tool generation (OpenAPI + custom) ----------

  wrapPath(
    refPath: string,
    refFunction: SdkRequestType
  ): Array<ReturnType<typeof defineTool>> {
    type MethodShape = {
      operationId: string;
      description: string;
      parameters?: Parameter[];
      requestBody?: unknown;
    };
    const tools: Array<ReturnType<typeof defineTool>> = [];

    const buildTool = (
      method: "get" | "post" | "delete",
      methodShape: MethodShape
    ): ReturnType<typeof defineTool> => {
      return defineTool((z) => {
        const name = methodShape.operationId;
        const description = methodShape.description;
        const parameters = methodShape.parameters ?? [];

        const bodyKeys = new Set<string>();
        const propertyTypes = new Map<string, unknown>();
        let requestBodySchema: unknown | undefined;

        if (method === "post") {
          const postBody = (
            methodShape as unknown as {
              requestBody?: {
                content?: Record<string, { schema?: unknown }>;
              };
            }
          ).requestBody?.content?.["application/json"]?.schema;
          requestBodySchema = postBody;
        }

        const collectProps = (schema: unknown): void => {
          if (!schema) return;

          const s = schema as {
            properties?: Record<string, unknown>;
            allOf?: unknown[];
            oneOf?: unknown[];
            anyOf?: unknown[];
            $ref?: string;
          };

          if (s.$ref && typeof s.$ref === "string") {
            const refPath = s.$ref.replace("#/components/schemas/", "");
            const refSchema = (
              adminJson as unknown as {
                components?: { schemas?: Record<string, unknown> };
              }
            ).components?.schemas?.[refPath];
            if (refSchema) collectProps(refSchema);
            return;
          }

          if (s.properties && typeof s.properties === "object") {
            for (const [key, propSchema] of Object.entries(s.properties)) {
              bodyKeys.add(key);
              propertyTypes.set(key, propSchema);
            }
          }

          if (Array.isArray(s.allOf)) s.allOf.forEach(collectProps);
          if (Array.isArray(s.oneOf)) s.oneOf.forEach(collectProps);
          if (Array.isArray(s.anyOf)) s.anyOf.forEach(collectProps);
        };
        if (requestBodySchema) collectProps(requestBodySchema);

        return {
          name: `Admin${name}`,
          description: `${description}${this.generateUsageHint(
            name,
            methodShape,
            method
          )}`,
          inputSchema: {
            // Query + path params
            ...parameters
              .filter((p) => p.in != "header")
              .reduce((acc, param) => {
                switch (param.schema.type) {
                  case "string":
                    acc[param.name] = z.string().optional();
                    break;
                  case "number":
                    acc[param.name] = z.number().optional();
                    break;
                  case "boolean":
                    acc[param.name] = z.boolean().optional();
                    break;
                  case "array":
                    acc[param.name] = z.array(z.any()).optional();
                    break;
                  case "object":
                    acc[param.name] = z.record(z.any()).optional();
                    break;
                  default:
                    acc[param.name] = z.any().optional();
                }
                return acc;
              }, {} as Record<string, ZodTypeAny>),
            ...(method !== "get"
              ? { payload: z.record(z.any()).optional() }
              : {}),
            ...(method !== "get"
              ? Array.from(bodyKeys).reduce((acc, key) => {
                  const propType = propertyTypes.get(key) as
                    | {
                        type?: string;
                        description?: string;
                        example?: unknown;
                        items?: { type?: string };
                      }
                    | undefined;

                  if (propType?.type === "array") {
                    if (key === "options") {
                      acc[key] = z
                        .array(
                          z.object({
                            title: z.string(),
                            values: z.array(z.string()),
                          })
                        )
                        .optional()
                        .describe(
                          'Product options with title and values. Example: [{"title":"Size","values":["S","M","L"]}]'
                        );
                    } else {
                      acc[key] = z
                        .array(z.any())
                        .optional()
                        .describe(
                          propType.description || `Array field: ${key}`
                        );
                    }
                  } else if (propType?.type === "object") {
                    acc[key] = z
                      .record(z.any())
                      .optional()
                      .describe(
                        propType.description ||
                          `Object field: ${key}. Use {} if not needed.`
                      );
                  } else if (propType?.type === "string") {
                    acc[key] = z
                      .string()
                      .optional()
                      .describe(propType.description || `String field: ${key}`);
                  } else if (propType?.type === "number") {
                    acc[key] = z
                      .number()
                      .optional()
                      .describe(propType.description || `Number field: ${key}`);
                  } else if (propType?.type === "boolean") {
                    acc[key] = z
                      .boolean()
                      .optional()
                      .describe(
                        propType.description || `Boolean field: ${key}`
                      );
                  } else {
                    acc[key] = z
                      .any()
                      .optional()
                      .describe(propType?.description || `Field: ${key}`);
                  }
                  return acc;
                }, {} as Record<string, ZodTypeAny>)
              : {}),
          },

          handler: async (input: Record<string, unknown>): Promise<unknown> => {
            // Separate params by location
            const pathParams = parameters
              .filter((p) => p.in === "path")
              .map((p) => p.name);
            const queryParamNames = parameters
              .filter((p) => p.in === "query")
              .map((p) => p.name);

            // Build final path by replacing {param}
            let finalPath = refPath;
            for (const pName of pathParams) {
              const val = (input as Record<string, unknown>)[pName];
              if (val === undefined || val === null) continue;
              finalPath = finalPath.replace(
                new RegExp(`\\{${pName}\\}`, "g"),
                encodeURIComponent(String(val))
              );
            }

            // Build body from non-path/query inputs
            const basePayloadRaw = (input as Record<string, unknown>)[
              "payload"
            ];
            let initialBody: Record<string, unknown> = {};
            if (
              basePayloadRaw &&
              typeof basePayloadRaw === "object" &&
              !Array.isArray(basePayloadRaw)
            ) {
              initialBody = { ...(basePayloadRaw as Record<string, unknown>) };
            }
            const body = Object.entries(input).reduce((acc, [key, value]) => {
              if (
                pathParams.includes(key) ||
                queryParamNames.includes(key) ||
                key === "payload"
              )
                return acc;
              if (value === undefined) return acc;
              (acc as Record<string, unknown>)[key] = value as unknown;
              return acc;
            }, initialBody);

            // Query object from declared query params only
            const queryObj: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(input)) {
              if (!queryParamNames.includes(key)) continue;
              if (value === undefined || value === null) continue;
              queryObj[key] = value;
            }

            if (Object.keys(queryObj).length > 0) {
              finalPath = this.withQuery(finalPath, queryObj);
            }

            if (method === "get") {
              const response = await this.sdk.client.fetch(finalPath, {
                method: method,
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  ...(this.adminToken
                    ? { Authorization: `Bearer ${this.adminToken}` }
                    : {}),
                },
              });
              return response;
            }

            const response = await this.sdk.client.fetch(finalPath, {
              method: method,
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(this.adminToken
                  ? { Authorization: `Bearer ${this.adminToken}` }
                  : {}),
              },
              body,
            });

            if (/^\/admin\/(variants|products)\b/.test(finalPath)) {
              this.clearVariantCache();
            }

            return response;
          },
        };
      });
    };

    if ((refFunction as unknown as { get?: MethodShape }).get) {
      tools.push(
        buildTool("get", (refFunction as unknown as { get: MethodShape }).get)
      );
    }
    if ((refFunction as unknown as { post?: MethodShape }).post) {
      tools.push(
        buildTool(
          "post",
          (refFunction as unknown as { post: MethodShape }).post
        )
      );
    }
    if ((refFunction as unknown as { delete?: MethodShape }).delete) {
      tools.push(
        buildTool(
          "delete",
          (refFunction as unknown as { delete: MethodShape }).delete
        )
      );
    }

    return tools;
  }

  private generateUsageHint(
    operationId: string,
    _methodShape: Record<string, unknown>,
    method: string
  ): string {
    if (method === "post") {
      if (operationId.includes("Batch")) {
        return " **BATCH OPERATION**: Only use this for bulk operations with multiple items. Requires arrays: create[], update[], delete[]. For single operations, use the non-batch version.";
      }
      if (operationId.includes("PostProducts")) {
        return ' **REQUIRED**: title (string), options (array with title and values). Example: {"title":"Product Name","options":[{"title":"Size","values":["S","M","L"]}]';
      }
      if (operationId.includes("PostCustomers")) {
        return " **REQUIRED**: email (string). Optional: first_name, last_name, phone. Do not provide metadata as string.";
      }
      if (operationId.includes("Inventory")) {
        return " **INVENTORY**: Use for stock management. Requires location_id, inventory_item_id, stocked_quantity.";
      }
    }
    return "";
  }

  /**
   * Custom analytics tools (general & composable).
   * - orders_count: counts non-canceled orders in [start,end) UTC.
   * - sales_aggregate: top entities by metric with actable IDs.
   *
   * Accepts RANGE aliases:  (start,end) | (start_date,end_date) | (from,to)
   * Accepts GROUP aliases:  group_by | grouping | group | groupby  (values like "product", "product_id", "variant", "variant_id")
   * Accepts METRIC aliases: metric | measure | by | agg | aggregate ("quantity" | "qty" | "units" | "orders" | "order_count" | "revenue" | "sales" | "amount" | "gmv")
   */
  private defineAnalyticsTools(): Array<ReturnType<typeof defineTool>> {
    // --- alias coercers ---
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
      if (v.startsWith("product")) return "product"; // "product", "product_id", "products", etc.
      if (v.startsWith("variant")) return "variant"; // "variant", "variant_id", "variants", etc.
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
      if (["orders", "order", "order_count", "num_orders"].includes(v))
        return "orders";
      if (["revenue", "sales", "amount", "gmv", "turnover"].includes(v))
        return "revenue";
      return undefined;
    };

    const orders_count = defineTool((z) => ({
      name: "orders_count",
      description:
        "Count non-canceled orders in a UTC date range [start, end). Returns { count }.",
      // accept range aliases; validate after coercion
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
        const schema = z.object({
          start: z.string().datetime(),
          end: z.string().datetime(),
        });
        const parsed = schema.safeParse({ start, end });
        if (!parsed.success)
          throw new Error(`Invalid input: ${parsed.error.message}`);
        const count = await this.countOrdersInRange(start, end);
        return { start, end, count };
      },
    }));

    const sales_aggregate = defineTool((z) => ({
      name: "sales_aggregate",
      description:
        "Aggregate sales in a UTC date range with grouping and metric. Returns actable IDs.",
      // accept aliases; validate after coercion
      inputSchema: {
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
        start_date: z.string().datetime().optional(),
        end_date: z.string().datetime().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),

        group_by: z
          .union([z.literal("product"), z.literal("variant")])
          .optional(),
        grouping: z.string().optional(),
        group: z.string().optional(),
        groupby: z.string().optional(),

        metric: z
          .union([
            z.literal("quantity"),
            z.literal("revenue"),
            z.literal("orders"),
          ])
          .optional(),
        measure: z.string().optional(),
        by: z.string().optional(),
        agg: z.string().optional(),
        aggregate: z.string().optional(),

        limit: z.number().int().min(1).max(50).default(5),
        sort: z.union([z.literal("desc"), z.literal("asc")]).default("desc"),
      },
      handler: async (input: Record<string, unknown>): Promise<unknown> => {
        // ranges
        const rng = coerceRange(input);
        if (!rng.start || !rng.end) {
          throw new Error(
            "Missing required range. Provide (start,end) or (start_date,end_date) or (from,to) as ISO date-times."
          );
        }

        // grouping & metric
        const group_by = coerceGroupBy(input);
        const metric = coerceMetric(input);
        if (!group_by)
          throw new Error(
            "Missing or invalid grouping. Use 'group_by' (or 'grouping') with 'product'/'product_id' or 'variant'/'variant_id'."
          );
        if (!metric)
          throw new Error(
            "Missing or invalid metric. Use 'metric' (or 'measure') with 'quantity'|'revenue'|'orders'."
          );

        // other params
        const limit =
          typeof input.limit === "number" && Number.isInteger(input.limit)
            ? Math.max(1, Math.min(50, input.limit))
            : 5;
        const sort = (
          String(input.sort ?? "desc").toLowerCase() === "asc" ? "asc" : "desc"
        ) as "asc" | "desc";

        // re-validate final values
        const schema = z.object({
          start: z.string().datetime(),
          end: z.string().datetime(),
          group_by: z.union([z.literal("product"), z.literal("variant")]),
          metric: z.union([
            z.literal("quantity"),
            z.literal("revenue"),
            z.literal("orders"),
          ]),
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
        if (!parsed.success)
          throw new Error(`Invalid input: ${parsed.error.message}`);

        const { start, end } = parsed.data;

        const orders = await this.fetchOrdersWithItemsInRange(start, end);

        type Agg = {
          key: string; // product_id or variant_id
          product_id?: string;
          variant_id?: string;
          sku?: string | null;
          title?: string | null;
          quantity: number;
          revenue: number;
          orderIds: Set<string>;
        };
        const aggMap = new Map<string, Agg>();

        const addToAgg = (key: string, patch: Partial<Agg>) => {
          const curr = aggMap.get(key) ?? {
            key,
            quantity: 0,
            revenue: 0,
            orderIds: new Set<string>(),
          };
          if (patch.quantity) curr.quantity += patch.quantity;
          if (patch.revenue) curr.revenue += patch.revenue;
          if (patch.orderIds)
            patch.orderIds.forEach((id) => curr.orderIds.add(id));
          if (patch.product_id && !curr.product_id)
            curr.product_id = patch.product_id;
          if (patch.variant_id && !curr.variant_id)
            curr.variant_id = patch.variant_id;
          if (patch.sku && !curr.sku) curr.sku = patch.sku;
          if (patch.title && !curr.title) curr.title = patch.title;
          aggMap.set(key, curr);
        };

        const toNum = (x: unknown): number => {
          if (typeof x === "number" && Number.isFinite(x)) return x;
          const n = Number(x);
          return Number.isFinite(n) ? n : 0;
        };

        for (const o of orders) {
          const oid = o.id ?? "";
          const items = Array.isArray(o.items) ? o.items : [];
          for (const it of items) {
            const qty = toNum(it.quantity);
            if (qty <= 0) continue;

            const lineTotal =
              typeof it.total === "number"
                ? it.total
                : toNum(it.unit_price) * qty;

            let variantId =
              (it.variant_id as string | null) ?? it?.variant?.id ?? undefined;
            let productId =
              (it.product_id as string | null) ??
              it?.variant?.product_id ??
              it?.variant?.product?.id ??
              undefined;

            // If grouping by product and productId missing but we have variantId, look it up
            if (group_by === "product" && !productId && variantId) {
              const resolved = await this.resolveProductFromVariant(variantId);
              productId = resolved.product_id ?? productId;
              if (!it.title && resolved.title) it.title = resolved.title;
              if (!it.sku && resolved.sku) it.sku = resolved.sku;
            }

            const sku = it?.sku ?? it?.variant?.sku ?? null;
            const title =
              it?.title ??
              it?.variant?.title ??
              it?.variant?.product?.title ??
              null;

            const key = group_by === "variant" ? variantId : productId;
            if (!key) continue;

            addToAgg(key, {
              quantity: qty,
              revenue: toNum(lineTotal),
              orderIds: new Set<string>(oid ? [oid] : []),
              product_id: productId,
              variant_id: variantId,
              sku,
              title,
            });
          }
        }

        const rows = Array.from(aggMap.values()).map((r) => {
          const ordersCount = r.orderIds.size;
          const score =
            metric === "quantity"
              ? r.quantity
              : metric === "revenue"
              ? r.revenue
              : ordersCount;
          return { ...r, score, orders: ordersCount };
        });

        rows.sort((a, b) =>
          sort === "desc" ? b.score - a.score : a.score - b.score
        );
        const top = rows.slice(0, limit).map((r, i) => ({
          rank: i + 1,
          product_id: r.product_id ?? null,
          variant_id: r.variant_id ?? null,
          sku: r.sku ?? null,
          title: r.title ?? null,
          quantity: r.quantity,
          revenue: r.revenue,
          orders: r.orders,
          metric: metric,
          value:
            metric === "quantity"
              ? r.quantity
              : metric === "revenue"
              ? r.revenue
              : r.orders,
        }));

        return {
          start: rng.start,
          end: rng.end,
          group_by,
          metric,
          results: top,
          xKey: "rank",
          yKey: "value",
          title: `Top ${group_by}s by ${metric}`,
        };
      },
    }));

    return [orders_count, sales_aggregate];
  }

  defineTools(admin = adminJson): Array<ReturnType<typeof defineTool>> {
    const paths = Object.entries(admin.paths) as [string, SdkRequestType][];
    const tools: Array<ReturnType<typeof defineTool>> = [];
    paths.forEach(([path, refFunction]) => {
      const ts = this.wrapPath(path, refFunction);
      tools.push(...ts);
    });
    tools.push(...this.defineAnalyticsTools()); // analytics tool(s)
    return tools;
  }
}
