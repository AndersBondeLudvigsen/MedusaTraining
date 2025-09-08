import Medusa from "@medusajs/js-sdk";
import {
    IS_DEV,
    MEDUSA_BACKEND_URL,
    MEDUSA_PASSWORD,
    MEDUSA_USERNAME
} from "../config/config";
import { createHttp } from "../http/client";
import { createVariantsRepo } from "../repositories/variants-repo";
import { createOrdersRepo } from "../repositories/orders-repo";
import { createAnalyticsService } from "./analytics-service";
import { createOpenApiTools } from "../tools/openapi-tool-factory";
import { createAnalyticsTools } from "../tools/analytics-tool-factory";

export default class MedusaAdminService {
    private sdk: Medusa;
    private token = "";
    public http;
    public variants;
    public orders;
    public analytics;
    public tools: Array<ReturnType<typeof createOpenApiTools>[number]>;

    constructor() {
        this.sdk = new Medusa({
            baseUrl: MEDUSA_BACKEND_URL,
            debug: IS_DEV,
            publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
            auth: { type: "jwt" }
        });
        this.http = createHttp(this.sdk, () => this.token);
        this.variants = createVariantsRepo(this.http);
        this.orders = createOrdersRepo(this.http);
        this.analytics = createAnalyticsService(this.orders, this.variants);
        this.tools = [
            ...createAnalyticsTools(this.analytics),
            ...createOpenApiTools(this.http)
        ];
    }

    async init(): Promise<void> {
        const res = (await (this.sdk as any).auth.login("user", "emailpass", {
            email: MEDUSA_USERNAME,
            password: MEDUSA_PASSWORD
        })) as any;
        const token =
            res?.token ?? res?.access_token ?? res?.jwt ?? res?.toString?.();
        this.token =
            typeof token === "string" && token && token !== "[object Object]"
                ? token
                : "";
    }

    defineTools() {
        return this.tools;
    }
}
