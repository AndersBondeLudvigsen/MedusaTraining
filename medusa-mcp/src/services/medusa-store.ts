import Medusa from "@medusajs/js-sdk";
import { config } from "dotenv";
import { z, ZodTypeAny } from "zod";
import storeJson from "../oas/store.json";
import { SdkRequestType, StoreJson, Parameter } from "../types/store-json";
import { defineTool, InferToolHandlerInput } from "../utils/define-tools";

config();

const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000";

export default class MedusaStoreService {
    sdk: Medusa;
    constructor(
        medusaBackendUrl: string = MEDUSA_BACKEND_URL,
        apiKey: string = process.env.PUBLISHABLE_KEY ?? ""
    ) {
        this.sdk = new Medusa({
            baseUrl: medusaBackendUrl ?? MEDUSA_BACKEND_URL,
            debug: process.env.NODE_ENV === "development",
            publishableKey: apiKey ?? process.env.PUBLISHABLE_KEY,
            auth: {
                type: "session"
            }
        });
    }

    wrapPath(refPath: string, refFunction: SdkRequestType) {
        return defineTool((z): any => {
            let name;
            let description;
            let parameters: Parameter[] = [];
            let method = "get";
            if ("get" in refFunction) {
                method = "get";
                name = refFunction.get.operationId;
                description = refFunction.get.description;
                parameters = refFunction.get.parameters;
            } else if ("post" in refFunction) {
                method = "post";
                name = refFunction.post.operationId;
                description = refFunction.post.description;
                parameters = refFunction.post.parameters ?? [];
            }
            if (!name) {
                throw new Error("No name found for the function");
            }

            return {
                name: name!,
                description: description,
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
                        }, {} as any)
                },

                handler: async (
                    input: InferToolHandlerInput<any, ZodTypeAny>
                ): Promise<any> => {
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
                        const val = (input as any)[pName];
                        if (val === undefined || val === null) {
                            // If path param is missing, leave as-is; server may handle error
                            continue;
                        }
                        finalPath = finalPath.replace(
                            new RegExp(`\\{${pName}\\}`, "g"),
                            encodeURIComponent(String(val))
                        );
                    }

                    // Build body from non-path, non-query inputs (most POST endpoints expect JSON body)
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
                            acc[key] = value;
                            return acc;
                        },
                        {} as Record<string, any>
                    );

                    // Build query from remaining non-path, non-body values
                    const queryEntries: [string, string][] = [];
                    for (const [key, value] of Object.entries(input)) {
                        if (
                            pathParams.includes(key) ||
                            !queryParamNames.includes(key)
                        ) {
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
                            // JSON-encode objects in query if needed
                            queryEntries.push([key, JSON.stringify(value)]);
                        } else {
                            queryEntries.push([key, String(value)]);
                        }
                    }
                    const query = new URLSearchParams(queryEntries);
                    if (method === "get") {
                        console.error(
                            `Fetching ${finalPath} with GET ${query.toString()}`
                        );
                        const response = await this.sdk.client.fetch(
                            finalPath,
                            {
                                method: method,
                                headers: {
                                    "Content-Type": "application/json",
                                    "Accept": "application/json",
                                    "Authorization": `Bearer ${process.env.PUBLISHABLE_KEY}`
                                },
                                query: query
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
                                    "Authorization": `Bearer ${process.env.PUBLISHABLE_KEY}`
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

    defineTools(store = storeJson): any[] {
        const paths = Object.entries(store.paths) as [string, SdkRequestType][];
        const tools = paths.map(([path, refFunction]) =>
            this.wrapPath(path, refFunction)
        );
        return tools;
    }
}
