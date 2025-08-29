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
    ): ReturnType<typeof defineTool> {
        type MethodShape = {
            operationId: string;
            description: string;
            parameters?: Parameter[];
        };
        return defineTool((z) => {
            let name;
            let description;
            let parameters: Parameter[] = [];
            let method = "get";
            if ("get" in refFunction) {
                method = "get";
                const getM = (refFunction as unknown as { get: MethodShape })
                    .get;
                name = getM.operationId;
                description = getM.description;
                parameters = getM.parameters ?? [];
            } else if ("post" in refFunction) {
                method = "post";
                const postM = (refFunction as unknown as { post: MethodShape })
                    .post;
                name = postM.operationId;
                description = postM.description;
                parameters = postM.parameters ?? [];
            } else if ("delete" in refFunction) {
                method = "delete";
                const delM = (refFunction as unknown as { delete: MethodShape })
                    .delete;
                name = delM.operationId;
                description = delM.description;
                parameters = delM.parameters ?? [];
            }
            if (!name) {
                throw new Error("No name found for path: " + refPath);
            }
            return {
                name: `Admin${name}`,
                description: `This tool helps store administors. ${description}`,
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
                                    acc[param.name] = z
                                        .array(z.string())
                                        .optional();
                                    break;
                                case "object":
                                    acc[param.name] = z.object({}).optional();
                                    break;
                                default:
                                    acc[param.name] = z.string().optional();
                            }
                            return acc;
                        }, {} as Record<string, ZodTypeAny>)
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
                        const val = (input as Record<string, unknown>)[pName];
                        if (val === undefined || val === null) {
                            continue;
                        }
                        finalPath = finalPath.replace(
                            new RegExp(`\\{${pName}\\}`, "g"),
                            encodeURIComponent(String(val))
                        );
                    }

                    // Build body from non-path, non-query inputs
                    const body = Object.entries(input).reduce(
                        (acc, [key, value]) => {
                            if (
                                pathParams.includes(key) ||
                                queryParamNames.includes(key)
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
                        {} as Record<string, unknown>
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
                    } else {
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
                }
            };
        });
    }

    defineTools(admin = adminJson): Array<ReturnType<typeof defineTool>> {
        const paths = Object.entries(admin.paths) as [string, SdkRequestType][];
        const tools = paths.map(([path, refFunction]) =>
            this.wrapPath(path, refFunction)
        );
        return tools;
    }
}
