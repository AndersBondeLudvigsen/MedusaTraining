import { ZodTypeAny } from "zod";
import adminJson from "../oas/admin.json";
import { defineTool } from "../utils/define-tools";
import type { SdkRequestType, Parameter } from "../types/admin-json";
import type { Http } from "../http/client";

export function createOpenApiTools(
  http: Http,
  admin = adminJson
): Array<ReturnType<typeof defineTool>> {
  const toTools: Array<ReturnType<typeof defineTool>> = [];

  const wrapPath = (refPath: string, refFunction: SdkRequestType): void => {
    type MethodShape = {
      operationId: string;
      description: string;
      parameters?: Parameter[];
      requestBody?: unknown;
    };

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
            const refSchema = (admin as any).components?.schemas?.[refPath];
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

        const usageHint = (
          operationId: string,
          method: string,
          pathHint: string
        ) => {
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
          if (
            method === "get" &&
            (operationId.includes("GetOrders") || pathHint === "/admin/orders")
          ) {
            return " NOTE: For counting or summarizing orders (e.g., 'how many orders', 'total sales'), prefer the analytics tools: orders_count or sales_aggregate.";
          }
          return "";
        };

        return {
          name: `Admin${name}`,
          description: `${description}${usageHint(name, method, refPath)}`,
          inputSchema: {
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
            const pathParams = parameters
              .filter((p) => p.in === "path")
              .map((p) => p.name);
            const queryParamNames = parameters
              .filter((p) => p.in === "query")
              .map((p) => p.name);

            let finalPath = refPath;
            for (const pName of pathParams) {
              const val = (input as Record<string, unknown>)[pName];
              if (val === undefined || val === null) continue;
              finalPath = finalPath.replace(
                new RegExp(`\\{${pName}\\}`, "g"),
                encodeURIComponent(String(val))
              );
            }

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

            const queryObj: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(input)) {
              if (!queryParamNames.includes(key)) continue;
              if (value === undefined || value === null) continue;
              queryObj[key] = value;
            }

            switch (method) {
              case "get":
                return await http.get(finalPath, queryObj);
              case "post":
                return await http.post(finalPath, body, queryObj);
              case "delete":
                return await http.del(finalPath, queryObj);
              default:
                return {};
            }
          },
        };
      });
    };

    const m = refFunction as any;
    if (m.get) toTools.push(buildTool("get", m.get));
    if (m.post) toTools.push(buildTool("post", m.post));
    if (m.delete) toTools.push(buildTool("delete", m.delete));
  };

  const paths = Object.entries((admin as any).paths) as [
    string,
    SdkRequestType
  ][];
  paths.forEach(([path, refFunction]) => wrapPath(path, refFunction));
  return toTools;
}
