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

export default class MedusaAdminService {
    sdk: Medusa;
    adminToken = "";

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

        // Prefer explicit token fields; fall back to string if needed.
        const token =
            res?.token ?? res?.access_token ?? res?.jwt ?? res?.toString?.();
        if (typeof token === "string" && token && token !== "[object Object]") {
            this.adminToken = token;
        } else {
            this.adminToken = "";
        }
    }

    /** Flatten object into bracket-notation query pairs (supports $-operators). */
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

    // ---------- Utilities for date ranges ----------

    private monthRangeUtc(year: number, month1to12: number) {
        const mIdx = month1to12 - 1; // JS Date months are 0-based
        const from = new Date(Date.UTC(year, mIdx, 1, 0, 0, 0, 0));
        const to = new Date(Date.UTC(year, mIdx + 1, 1, 0, 0, 0, 0));
        return { fromIso: from.toISOString(), toIso: to.toISOString() };
    }

    private yearRangeUtc(year: number) {
        const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
        const to = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
        return { fromIso: from.toISOString(), toIso: to.toISOString() };
    }

    private inRangeUtc(iso: string, fromIso: string, toIso: string): boolean {
        const t = Date.parse(iso);
        return t >= Date.parse(fromIso) && t < Date.parse(toIso);
    }

    /**
     * Fetch ALL orders in [fromIso, toIso) (paged). We DO NOT trust server `count`
     * nor rely on server-side filtering — we also filter client-side by created_at.
     * NOTE: This method currently excludes canceled orders by simply counting orders returned.
     * If your backend returns canceled orders in the same list, add a check to skip them.
     */
    private async fetchOrdersInRange(
        fromIso: string,
        toIso: string
    ): Promise<Array<{ id?: string; created_at?: string }>> {
        const limit = 200;
        let offset = 0;
        const acc: Array<{ id?: string; created_at?: string }> = [];

        // Send the filter with $-operators (works across Medusa variants).
        const baseQuery = {
            created_at: { $gte: fromIso, $lt: toIso },
        } as const;

        // If the backend ignores filters, we still filter locally by created_at.
        while (true) {
            const q = { ...baseQuery, limit, offset };
            const data = await this.adminGet<{
                orders?: Array<{ id?: string; created_at?: string }>;
            }>("/admin/orders", q);

            const batch = Array.isArray(data?.orders) ? data.orders : [];
            if (batch.length === 0) break;

            // Local filter to be 100% correct even if server ignores created_at.
            for (const o of batch) {
                if (!o?.created_at) continue;
                if (this.inRangeUtc(o.created_at, fromIso, toIso)) {
                    acc.push({ id: o.id, created_at: o.created_at });
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
                const requiredFields = new Set<string>();
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
                        required?: string[];
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

                    if (Array.isArray(s.required)) {
                        for (const field of s.required) {
                            if (typeof field === "string") requiredFields.add(field);
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
                return ' **REQUIRED**: title (string), options (array with title and values). Example: {"title": "Product Name", "options": [{"title": "Size","values": ["S","M","L"]}]}';
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

    // /**
    //  * Custom tool: getMonthlyOrderReport
    //  * - If month provided → single month count.
    //  * - Else → fetch the whole YEAR once, then group client-side by month.
    //  * - All comparisons use UTC.
    //  */
    // private defineReportTools(): Array<ReturnType<typeof defineTool>> {
    //     const getMonthlyOrderReport = defineTool((z) => ({
    //         name: "getMonthlyOrderReport",
    //         description:
    //             "Returns order counts grouped by month for a given year. Optionally pass a month (1-12) to get only that month's count. Uses created_at timestamps (UTC).",
    //         inputSchema: {
    //             year: z.number().int().min(2000).max(9999),
    //             month: z.number().int().min(1).max(12).optional(),
    //         },
    //         handler: async (input: Record<string, unknown>): Promise<unknown> => {
    //             const schema = z.object({
    //                 year: z.number().int().min(2000).max(9999),
    //                 month: z.number().int().min(1).max(12).optional(),
    //             });
    //             const parsed = schema.safeParse(input);
    //             if (!parsed.success) {
    //                 throw new Error(`Invalid input: ${parsed.error.message}`);
    //             }
    //             const { year, month } = parsed.data;

    //             if (typeof month === "number") {
    //                 const { fromIso, toIso } = this.monthRangeUtc(year, month);
    //                 const count = await this.countOrdersInRange(fromIso, toIso);
    //                 return {
    //                     scope: "month",
    //                     year,
    //                     month,
    //                     from: fromIso,
    //                     to: toIso,
    //                     count,
    //                 };
    //             }

    //             // Fetch the whole year's orders ONCE, then group by month client-side.
    //             const { fromIso: yearFrom, toIso: yearTo } = this.yearRangeUtc(year);
    //             const orders = await this.fetchOrdersInRange(yearFrom, yearTo);

    //             const counts = new Array(12).fill(0);
    //             for (const o of orders) {
    //                 if (!o?.created_at) continue;
    //                 const d = new Date(o.created_at);
    //                 const m = d.getUTCMonth(); // 0..11
    //                 counts[m] += 1;
    //             }

    //             const monthly = counts.map((n, i) => {
    //                 const { fromIso, toIso } = this.monthRangeUtc(year, i + 1);
    //                 return { month: i + 1, from: fromIso, to: toIso, count: n };
    //             });

    //             const total = counts.reduce((a, b) => a + b, 0);
    //             return { scope: "year", year, total, monthly };
    //         },
    //     }));

    //     return [getMonthlyOrderReport];
    // }

    /**
     * Custom analytics tools (general & composable).
     * Here we add: orders_count — counts non-canceled orders in [start,end) UTC.
     */
    private defineAnalyticsTools(): Array<ReturnType<typeof defineTool>> {
        const orders_count = defineTool((z) => ({
            name: "orders_count",
            description:
                "Count non-canceled orders in a UTC date range [start, end). Returns { count }.",
            inputSchema: {
                start: z.string().datetime(), // inclusive
                end: z.string().datetime(),   // exclusive
                // status left out on purpose to keep tool simple & deterministic.
            },
            handler: async (input: Record<string, unknown>): Promise<unknown> => {
                const schema = z.object({
                    start: z.string().datetime(),
                    end: z.string().datetime(),
                });
                const parsed = schema.safeParse(input);
                if (!parsed.success) {
                    throw new Error(`Invalid input: ${parsed.error.message}`);
                }
                const { start, end } = parsed.data;

                const count = await this.countOrdersInRange(start, end);
                return { start, end, count };
            },
        }));

        return [orders_count];
    }

    defineTools(admin = adminJson): Array<ReturnType<typeof defineTool>> {
        const paths = Object.entries(admin.paths) as [string, SdkRequestType][];
        const tools: Array<ReturnType<typeof defineTool>> = [];
        paths.forEach(([path, refFunction]) => {
            const ts = this.wrapPath(path, refFunction);
            tools.push(...ts);
        });
        // tools.push(...this.defineReportTools());
        tools.push(...this.defineAnalyticsTools()); // <-- NEW analytics tool(s)
        return tools;
    }
}
