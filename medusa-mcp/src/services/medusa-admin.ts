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
                        allOf?: unknown[];
                        oneOf?: unknown[];
                        anyOf?: unknown[];
                    };
                    if (s.properties && typeof s.properties === "object") {
                        for (const key of Object.keys(s.properties)) {
                            bodyKeys.add(key);
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
