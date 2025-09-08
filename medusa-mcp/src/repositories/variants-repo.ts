import type { Http } from "../http/client";
import { createTTLMap } from "../utils/cache";
import type { VariantResolution } from "../types/medusa-admin";

export function createVariantsRepo(http: Http): {
  resolve: (variantId: string) => Promise<VariantResolution>;
  clear: () => void;
} {
  const cache = createTTLMap<string, VariantResolution>(15 * 60_000, 5000);

  async function resolve(variantId: string): Promise<VariantResolution> {
    const c = cache.get(variantId);
    if (c) return c;
    try {
      const r = await http.get<{
        variant?: {
          product_id?: string;
          product?: { id?: string; title?: string } | null;
          title?: string | null;
          sku?: string | null;
        };
      }>(`/admin/variants/${encodeURIComponent(variantId)}`);
      const v = r?.variant ?? {};
      const entry: VariantResolution = {
        product_id: v.product_id ?? v.product?.id,
        title: v.product?.title ?? v.title ?? null,
        sku: v.sku ?? null,
      };
      cache.set(variantId, entry);
      return entry;
    } catch {
      const entry: VariantResolution = {
        product_id: undefined,
        title: null,
        sku: null,
      };
      cache.set(variantId, entry);
      return entry;
    }
  }

  function clear(): void {
    cache.clear();
  }
  return { resolve, clear };
}
