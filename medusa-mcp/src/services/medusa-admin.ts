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
                type: "jwt"
            }
        });
    }

    async init(): Promise<void> {
        const res = await this.sdk.auth.login("user", "emailpass", {
            email: MEDUSA_USERNAME,
            password: MEDUSA_PASSWORD
        });
        this.adminToken = res.toString();
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

                // Collect simple body property keys from requestBody schema (best-effort)
                const bodyKeys = new Set<string>();
                const requiredFields = new Set<string>();
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
                        const refPath = s.$ref.replace(
                            "#/components/schemas/",
                            ""
                        );
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
                        for (const key of Object.keys(s.properties)) {
                            bodyKeys.add(key);
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
                    description: `This tool helps store administors. ${description}`,
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
                                        acc[param.name] = z
                                            .boolean()
                                            .optional();
                                        break;
                                    case "array":
                                        acc[param.name] = z
                                            .array(z.any())
                                            .optional();
                                        break;
                                    case "object":
                                        acc[param.name] = z
                                            .record(z.any())
                                            .optional();
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
                                  acc[key] = z.any().optional();
                                  return acc;
                              }, {} as Record<string, ZodTypeAny>)
                            : {})
                    },

                    handler: async (
                        input: Record<string, unknown>
                    ): Promise<unknown> => {
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
                            const val = (input as Record<string, unknown>)[
                                pName
                            ];
                            if (val === undefined || val === null) {
                                continue;
                            }
                            finalPath = finalPath.replace(
                                new RegExp(`\\{${pName}\\}`, "g"),
                                encodeURIComponent(String(val))
                            );
                        }

                        // Build body from provided payload plus non-path, non-query inputs
                        const basePayloadRaw = (
                            input as Record<string, unknown>
                        )["payload"];
                        let initialBody: Record<string, unknown> = {};
                        if (
                            basePayloadRaw &&
                            typeof basePayloadRaw === "object" &&
                            !Array.isArray(basePayloadRaw)
                        ) {
                            initialBody = {
                                ...(basePayloadRaw as Record<string, unknown>)
                            };
                        }
                        const body = Object.entries(input).reduce(
                            (acc, [key, value]) => {
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
                                (acc as Record<string, unknown>)[key] =
                                    value as unknown;
                                return acc;
                            },
                            initialBody
                        );

                        // Generic handling of required fields with sensible defaults
                        if (method === "post" && requiredFields.size > 0) {
                            for (const requiredField of requiredFields) {
                                if (!(requiredField in body)) {
                                    // Provide sensible defaults for common required fields
                                    switch (requiredField) {
                                        case "title":
                                            body.title = "Untitled";
                                            break;
                                        case "name":
                                            body.name = "Unnamed";
                                            break;
                                        case "options":
                                            body.options = [
                                                {
                                                    title: "Default option",
                                                    values: [
                                                        "Default option value"
                                                    ]
                                                }
                                            ];
                                            break;
                                        case "email":
                                            // Skip email - this should be provided by user
                                            break;
                                        case "password":
                                            // Skip password - this should be provided by user
                                            break;
                                        case "type":
                                            body.type = "default";
                                            break;
                                        case "status":
                                            body.status = "draft";
                                            break;
                                        case "currency_code":
                                            body.currency_code = "USD";
                                            break;
                                        case "amount":
                                            body.amount = 0;
                                            break;
                                        case "values":
                                            body.values = ["Default value"];
                                            break;
                                        default:
                                            // For unknown required fields, try to provide a reasonable default
                                            if (requiredField.includes("id")) {
                                                // Skip ID fields - these usually should be provided
                                                break;
                                            }
                                            // Provide a generic default
                                            (body as Record<string, unknown>)[
                                                requiredField
                                            ] = `default_${requiredField}`;
                                            break;
                                    }
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
                            const response = await this.sdk.client.fetch(
                                finalPath,
                                {
                                    method: method,
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Accept": "application/json",
                                        "Authorization": `Bearer ${this.adminToken}`
                                    },
                                    query
                                }
                            );
                            return response;
                        }
                        const response = await this.sdk.client.fetch(
                            finalPath,
                            {
                                method: method,
                                headers: {
                                    "Content-Type": "application/json",
                                    "Accept": "application/json",
                                    "Authorization": `Bearer ${this.adminToken}`
                                },
                                body
                            }
                        );
                        return response;
                    }
                };
            });
        };

        if ((refFunction as unknown as { get?: MethodShape }).get) {
            tools.push(
                buildTool(
                    "get",
                    (refFunction as unknown as { get: MethodShape }).get
                )
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

    defineTools(admin = adminJson): Array<ReturnType<typeof defineTool>> {
        const paths = Object.entries(admin.paths) as [string, SdkRequestType][];
        const tools: Array<ReturnType<typeof defineTool>> = [];
        paths.forEach(([path, refFunction]) => {
            const ts = this.wrapPath(path, refFunction);
            tools.push(...ts);
        });
        return tools;
    }
}
