import type { Http } from "../http/client";
import { inRangeUtc } from "../utils/time";
import type { AdminOrderMinimal } from "../types/medusa-admin";

export function createOrdersRepo(http: Http): {
    listInRange: (
        fromIso: string,
        toIso: string
    ) => Promise<AdminOrderMinimal[]>;
    withItems: (fromIso: string, toIso: string) => Promise<AdminOrderMinimal[]>;
} {
    async function listInRange(
        fromIso: string,
        toIso: string
    ): Promise<AdminOrderMinimal[]> {
        const limit = 200;
        let offset = 0;
        const acc: AdminOrderMinimal[] = [];
        const base = {
            created_at: { gte: fromIso, lt: toIso },
            // Ensure we include items and shipping_methods on the list payload
            // so downstream aggregations don't rely on per-order detail calls.
            // Using +field syntax to add to default response fields.
            fields:
                "+id,+created_at,+canceled_at,+items,+shipping_methods"
        } as const;
        // paginate
        while (true) {
            const q = { ...base, limit, offset } as Record<string, unknown>;
            const data = await http.get<{ orders?: AdminOrderMinimal[] }>(
                "/admin/orders",
                q
            );
            const batch = Array.isArray(data?.orders) ? data.orders : [];
            for (const o of batch) {
                if (o?.canceled_at || !o?.created_at) {
                    continue;
                }
                if (inRangeUtc(o.created_at, fromIso, toIso)) {
                    acc.push({
                        id: o.id,
                        created_at: o.created_at,
                        canceled_at: o.canceled_at,
                        // Some setups return minimal items on list; still pass through whatever we got.
                        items: o.items,
                        shipping_methods: (o as any).shipping_methods
                    });
                }
            }
            if (batch.length < limit) {
                break;
            }
            offset += limit;
        }
        return acc;
    }

    async function withItems(
        fromIso: string,
        toIso: string
    ): Promise<AdminOrderMinimal[]> {
        const list = await listInRange(fromIso, toIso);
        const detailed = await Promise.all(
            list.map(async (o) => {
                // If we already have both items and shipping methods on the list payload,
                // avoid fetching the order detail again.
                const hasItems = Array.isArray((o as any).items) && (o as any).items.length > 0;
                const hasShipping =
                    Array.isArray((o as any).shipping_methods) &&
                    (o as any).shipping_methods.length > 0;

                if (!o.id) {
                    return { ...o, items: [], shipping_methods: [] } as AdminOrderMinimal;
                }
                if (hasItems && hasShipping) {
                    return o;
                }

                try {
                    const detail = await http.get<{
                        order?: AdminOrderMinimal;
                    }>(`/admin/orders/${encodeURIComponent(o.id)}`);
                    return {
                        ...o,
                        items: detail?.order?.items ?? o.items ?? [],
                        shipping_methods:
                            detail?.order?.shipping_methods ?? o.shipping_methods ?? []
                    } as AdminOrderMinimal;
                } catch {
                    return {
                        ...o,
                        items: o.items ?? [],
                        shipping_methods: o.shipping_methods ?? []
                    } as AdminOrderMinimal;
                }
            })
        );
        return detailed;
    }

    return { listInRange, withItems };
}
