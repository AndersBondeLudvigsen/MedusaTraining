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
      auth: {
        type: "jwt",
      },
    });
  }

  async init(): Promise<void> {
    const res = await this.sdk.auth.login("user", "emailpass", {
      email: MEDUSA_USERNAME,
      password: MEDUSA_PASSWORD,
    });
    this.adminToken = res.toString();
  }

  /**
   * Helper: perform authenticated GET against Admin API with URLSearchParams.
   * Encodes object values as JSON strings (e.g. created_at filter objects).
   *
   * @param path The admin API path, e.g. "/admin/orders".
   * @param queryObj Plain object of query params; objects are JSON-stringified.
   * @returns Parsed JSON response typed as T.
   */
  private async adminGet<T = unknown>(
    path: string,
    queryObj: Record<string, unknown> = {}
  ): Promise<T> {
    const entries: [string, string][] = [];
    for (const [k, v] of Object.entries(queryObj)) {
      if (v === undefined || v === null) {
        continue;
      }
      if (Array.isArray(v)) {
        v.forEach((vv) => entries.push([k, String(vv)]));
      } else if (typeof v === "object") {
        entries.push([k, JSON.stringify(v)]);
      } else {
        entries.push([k, String(v)]);
      }
    }
    const query = new URLSearchParams(entries);
    const res = await this.sdk.client.fetch(path, {
      method: "get",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.adminToken}`,
      },
      query,
    });
    return res as T;
  }

  /**
   * Helper: count orders in a given [from, to) UTC ISO time range, using an efficient list call.
   * Uses limit=1 to minimize payload but relies on the response's `count` field.
   *
   * @param fromIso Inclusive ISO timestamp (UTC) for the start of range.
   * @param toIso Exclusive ISO timestamp (UTC) for the end of range.
   * @returns Number of orders created in the range.
   */
  private async countOrdersInRange(
    fromIso: string,
    toIso: string
  ): Promise<number> {
    const query = {
      limit: 1,
      created_at: { $gte: fromIso, $lt: toIso },
    } as const;
    const data = await this.adminGet<{
      orders?: unknown[];
      count?: number;
      offset?: number;
      limit?: number;
    }>("/admin/orders", query);
    // Typical Medusa list response: { orders: [], count: number, offset, limit }
    if (typeof data?.count === "number") {
      return data.count;
    }
    if (Array.isArray(data?.orders)) {
      return data.orders.length;
    }
    return 0;
  }

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
          if (!schema) {
            return;
          }
          const s = schema as {
            properties?: Record<string, unknown>;
            required?: string[];
            allOf?: unknown[];
            oneOf?: unknown[];
            anyOf?: unknown[];
            $ref?: string;
          };

          // Handle $ref by resolving to the actual schema
          if (s.$ref && typeof s.$ref === "string") {
            // Extract the reference path
            const refPath = s.$ref.replace("#/components/schemas/", "");
            const refSchema = (
              adminJson as unknown as {
                components?: {
                  schemas?: Record<string, unknown>;
                };
              }
            ).components?.schemas?.[refPath];
            if (refSchema) {
              collectProps(refSchema);
            }
            return;
          }

          // Collect properties
          if (s.properties && typeof s.properties === "object") {
            for (const [key, propSchema] of Object.entries(s.properties)) {
              bodyKeys.add(key);
              propertyTypes.set(key, propSchema);
            }
          }

          // Collect required fields
          if (Array.isArray(s.required)) {
            for (const field of s.required) {
              if (typeof field === "string") {
                requiredFields.add(field);
              }
            }
          }

          if (Array.isArray(s.allOf)) {
            s.allOf.forEach(collectProps);
          }
          if (Array.isArray(s.oneOf)) {
            s.oneOf.forEach(collectProps);
          }
          if (Array.isArray(s.anyOf)) {
            s.anyOf.forEach(collectProps);
          }
        };
        if (requestBodySchema) {
          collectProps(requestBodySchema);
        }

        return {
          name: `Admin${name}`,
          description: `${description}${this.generateUsageHint(
            name,
            methodShape,
            method
          )}`,
          inputSchema: {
            // Query and path params
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
            // Generic JSON payload support for non-GET methods
            ...(method !== "get"
              ? { payload: z.record(z.any()).optional() }
              : {}),
            // Best-effort top-level body fields to help LLMs choose POST tools
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

                  // Create more descriptive Zod schemas based on OpenAPI info
                  // BUT make them all optional since we provide defaults
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
                          'Product options with title and values. Example: [{"title": "Size", "values": ["S", "M", "L"]}]'
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
                          `Object field: ${key}. Use empty object {} if no specific data needed.`
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

            // Build final path by replacing {param} occurrences
            let finalPath = refPath;
            for (const pName of pathParams) {
              const val = (input as Record<string, unknown>)[pName];
              if (val === undefined || val === null) {
                continue;
              }
              finalPath = finalPath.replace(
                new RegExp(`\\{${pName}\\}`, "g"),
                encodeURIComponent(String(val))
              );
            }

            // Build body from provided payload plus non-path, non-query inputs
            const basePayloadRaw = (input as Record<string, unknown>)[
              "payload"
            ];
            let initialBody: Record<string, unknown> = {};
            if (
              basePayloadRaw &&
              typeof basePayloadRaw === "object" &&
              !Array.isArray(basePayloadRaw)
            ) {
              initialBody = {
                ...(basePayloadRaw as Record<string, unknown>),
              };
            }
            const body = Object.entries(input).reduce((acc, [key, value]) => {
              if (
                pathParams.includes(key) ||
                queryParamNames.includes(key) ||
                key === "payload"
              ) {
                return acc;
              }
              if (value === undefined) {
                return acc;
              }
              (acc as Record<string, unknown>)[key] = value as unknown;
              return acc;
            }, initialBody);

            // Schema-driven required field handling
            if (method === "post" && requiredFields.size > 0) {
              for (const requiredField of requiredFields) {
                const fieldValue = body[requiredField];
                const isFieldMissing =
                  fieldValue === undefined ||
                  fieldValue === null ||
                  (Array.isArray(fieldValue) && fieldValue.length === 0);

                if (isFieldMissing) {
                  // Get the property type information
                  const propType = propertyTypes.get(requiredField) as
                    | {
                        type?: string;
                        items?: unknown;
                        example?: unknown;
                        default?: unknown;
                      }
                    | undefined;

                  // Provide defaults based on schema type information
                  if (propType?.type === "object") {
                    body[requiredField] = propType.default ?? {};
                  } else if (propType?.type === "array") {
                    // For arrays, check if we have example data
                    if (propType.example) {
                      body[requiredField] = propType.example;
                    } else if (requiredField === "options") {
                      // Special case for product options - use schema knowledge
                      body[requiredField] = [
                        {
                          title: "Default option",
                          values: ["Default value"],
                        },
                      ];
                    } else {
                      body[requiredField] = [];
                    }
                  } else if (propType?.type === "string") {
                    body[requiredField] = propType.default ?? "";
                  } else if (propType?.type === "number") {
                    body[requiredField] = propType.default ?? 0;
                  } else if (propType?.type === "boolean") {
                    body[requiredField] = propType.default ?? false;
                  }
                  // If we don't know the type, skip it - don't guess
                }
              }
            }

            // Build query from declared query params only
            const queryEntries: [string, string][] = [];
            for (const [key, value] of Object.entries(input)) {
              if (!queryParamNames.includes(key)) {
                continue;
              }
              if (value === undefined || value === null) {
                continue;
              }
              if (Array.isArray(value)) {
                for (const v of value) {
                  queryEntries.push([key, String(v)]);
                }
              } else if (typeof value === "object") {
                queryEntries.push([key, JSON.stringify(value)]);
              } else {
                queryEntries.push([key, String(value)]);
              }
            }
            const query = new URLSearchParams(queryEntries);
            if (method === "get") {
              const response = await this.sdk.client.fetch(finalPath, {
                method: method,
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  Authorization: `Bearer ${this.adminToken}`,
                },
                query,
              });
              return response;
            }
            const response = await this.sdk.client.fetch(finalPath, {
              method: method,
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${this.adminToken}`,
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
    methodShape: Record<string, unknown>,
    method: string
  ): string {
    // Provide specific guidance for common operations
    if (method === "post") {
      if (operationId.includes("Batch")) {
        return " **BATCH OPERATION**: Only use this for bulk operations with multiple items. Requires arrays: create[], update[], delete[]. For single operations, use the non-batch version.";
      }

      if (operationId.includes("PostProducts")) {
        return ' **REQUIRED**: title (string), options (array with title and values). Example: {"title": "Product Name", "options": [{"title": "Size", "values": ["S", "M", "L"]}]}';
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
   * Custom tool: getMonthlyOrderReport
   * - Input: { year: number (required), month?: 1-12 (optional) }
   * - Behavior:
   *   - If month is provided, returns count for that month.
   *   - Else, returns counts for all 12 months and a total.
   * - Counts are based on created_at timestamps in UTC.
   */
  private defineReportTools(): Array<ReturnType<typeof defineTool>> {
    const monthRangeUtc = (year: number, month1to12: number) => {
      const mIdx = month1to12 - 1; // JS Date month is 0-based
      const from = new Date(Date.UTC(year, mIdx, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(year, mIdx + 1, 1, 0, 0, 0, 0));
      return { fromIso: from.toISOString(), toIso: to.toISOString() };
    };

    const yearMonthPairs = (year: number) =>
      Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));

    const getMonthlyOrderReport = defineTool((z) => ({
      name: "getMonthlyOrderReport",
      description:
        "Returns order counts grouped by month for a given year. Optionally pass a month (1-12) to get only that month's count. Uses created_at timestamps (UTC).",
      inputSchema: {
        year: z.number().int().min(2000).max(9999),
        month: z.number().int().min(1).max(12).optional(),
      },
      handler: async (input: Record<string, unknown>): Promise<unknown> => {
        const schema = z.object({
          year: z.number().int().min(2000).max(9999),
          month: z.number().int().min(1).max(12).optional(),
        });
        const parsed = schema.safeParse(input);
        if (!parsed.success) {
          throw new Error(`Invalid input: ${parsed.error.message}`);
        }
        const { year, month } = parsed.data;

        if (typeof month === "number") {
          const { fromIso, toIso } = monthRangeUtc(year, month);
          const count = await this.countOrdersInRange(fromIso, toIso);
          return {
            scope: "month",
            year,
            month,
            from: fromIso,
            to: toIso,
            count,
          };
        }

        const pairs = yearMonthPairs(year).map(({ month }) => {
          const { fromIso, toIso } = monthRangeUtc(year, month);
          return { month, fromIso, toIso };
        });
        const counts = await Promise.all(
          pairs.map(({ fromIso, toIso }) =>
            this.countOrdersInRange(fromIso, toIso)
          )
        );
        const monthly = pairs.map((p, i) => ({
          month: p.month,
          from: p.fromIso,
          to: p.toIso,
          count: counts[i],
        }));
        const total = counts.reduce((acc, n) => acc + n, 0);
        return { scope: "year", year, total, monthly };
      },
    }));

    return [getMonthlyOrderReport];
  }

  defineTools(admin = adminJson): Array<ReturnType<typeof defineTool>> {
    const paths = Object.entries(admin.paths) as [string, SdkRequestType][];
    const tools: Array<ReturnType<typeof defineTool>> = [];
    paths.forEach(([path, refFunction]) => {
      const ts = this.wrapPath(path, refFunction);
      tools.push(...ts);
    });
    // Append custom report tools (not generated from OpenAPI)
    tools.push(...this.defineReportTools());
    return tools;
  }
}
