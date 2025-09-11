import type { Http } from "../http/client";

type CountParams = {
  threshold: number;
  manage_inventory_only?: boolean;
};

export function createInventoryService(http: Http) {
  async function countLowInventoryProducts(params: CountParams): Promise<{
    threshold: number;
    count: number;
    variants_count: number;
  }> {
    const threshold = Math.max(0, Math.floor(params.threshold ?? 0));
    const manageOnly = params.manage_inventory_only !== false; // default true

    const limit = 200;
    let offset = 0;
    const productIds = new Set<string>();
    let variantsCount = 0;

    const baseQuery: Record<string, unknown> = {
      limit,
      // Request minimal product data plus needed variant fields
      fields: [
        "+id",
        "+variants.id",
        "+variants.manage_inventory",
        "+variants.inventory_quantity",
      ].join(","),
    };

    while (true) {
      const q = { ...baseQuery, offset } as Record<string, unknown>;
      const data = await http.get<{
        products?: Array<{
          id?: string;
          variants?: Array<{
            id?: string;
            manage_inventory?: boolean;
            inventory_quantity?: number | string | null;
          }>;
        }>;
      }>("/admin/products", q);

      const products = Array.isArray(data?.products) ? data!.products! : [];
      for (const p of products) {
        const pid = p?.id;
        const vars = Array.isArray(p?.variants) ? p!.variants! : [];
        let anyLow = false;
        for (const v of vars) {
          if (manageOnly && v?.manage_inventory === false) {
            continue;
          }
          const qtyRaw = v?.inventory_quantity as number | string | null | undefined;
          const qty =
            typeof qtyRaw === "number"
              ? qtyRaw
              : qtyRaw == null
              ? 0
              : Number(qtyRaw) || 0;
          if (qty < threshold) {
            variantsCount += 1;
            anyLow = true;
          }
        }
        if (anyLow && pid) {
          productIds.add(pid);
        }
      }

      if (products.length < limit) {
        break;
      }
      offset += limit;
    }

    return {
      threshold,
      count: productIds.size,
      variants_count: variantsCount,
    };
  }

  return {
    countLowInventoryProducts,
  };
}
