import type { Http } from "../http/client";

type CountParams = {
  threshold: number;
  manage_inventory_only?: boolean;
};

export function createInventoryService(http: Http) {
  async function fetchVariantsPage(
    offset: number,
    limit: number,
    manageOnly: boolean
  ): Promise<
    Array<{
      id?: string;
      product_id?: string;
      title?: string | null;
      sku?: string | null;
      manage_inventory?: boolean;
      inventory_quantity?: number | string | null;
    }>
  > {
    const query: Record<string, unknown> = {
      limit,
      offset,
      fields: [
        "+id",
        "+product_id",
        "+title",
        "+sku",
        "+manage_inventory",
        "+inventory_quantity",
      ].join(","),
    };
    if (manageOnly) {
      query.manage_inventory = true;
    }
    const data = await http.get<{
      variants?: Array<{
        id?: string;
        product_id?: string;
        title?: string | null;
        sku?: string | null;
        manage_inventory?: boolean;
        inventory_quantity?: number | string | null;
      }>;
    }>("/admin/product-variants", query);
    return Array.isArray(data?.variants) ? (data!.variants as any[]) : [];
  }

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

    while (true) {
      let batch: any[] = [];
      try {
        batch = await fetchVariantsPage(offset, limit, manageOnly);
      } catch {
        batch = [];
      }
      if (batch.length === 0) {
        break;
      }
      for (const v of batch) {
        if (manageOnly && v?.manage_inventory !== true) {
          continue;
        }
        const qtyRaw = v?.inventory_quantity as number | string | null | undefined;
        const qty =
          typeof qtyRaw === "number"
            ? qtyRaw
            : typeof qtyRaw === "string" && qtyRaw.trim() !== ""
            ? Number(qtyRaw)
            : undefined;
        if (typeof qty === "number" && Number.isFinite(qty) && qty < threshold) {
          variantsCount += 1;
          const pid = v?.product_id as string | undefined;
          if (pid) {
            productIds.add(pid);
          }
        }
      }
      if (batch.length < limit) {
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

  async function listLowInventoryProducts(params: CountParams): Promise<{
    threshold: number;
    count: number;
    variants_count: number;
    products: Array<{
      id: string;
      title: string | null;
      low_variants_count: number;
      low_variants: Array<{
        id: string;
        title: string | null;
        sku: string | null;
        inventory_quantity: number;
      }>;
    }>;
  }> {
    const threshold = Math.max(0, Math.floor(params.threshold ?? 0));
    const manageOnly = params.manage_inventory_only !== false; // default true

    const limit = 200;
    let offset = 0;
    const productsOut: Array<{
      id: string;
      title: string | null;
      low_variants_count: number;
      low_variants: Array<{
        id: string;
        title: string | null;
        sku: string | null;
        inventory_quantity: number;
      }>;
    }> = [];
    let variantsCount = 0;

    while (true) {
      let batch: any[] = [];
      try {
        batch = await fetchVariantsPage(offset, limit, manageOnly);
      } catch {
        batch = [];
      }
      if (batch.length === 0) {
        break;
      }
      for (const v of batch) {
        if (manageOnly && v?.manage_inventory !== true) {
          continue;
        }
        const qtyRaw = v?.inventory_quantity as number | string | null | undefined;
        const qty =
          typeof qtyRaw === "number"
            ? qtyRaw
            : typeof qtyRaw === "string" && qtyRaw.trim() !== ""
            ? Number(qtyRaw)
            : undefined;
        if (typeof qty === "number" && Number.isFinite(qty) && qty < threshold) {
          variantsCount += 1;
          const pid = v?.product_id as string | undefined;
          if (!pid) continue;
          let row = productsOut.find((r) => r.id === pid);
          if (!row) {
            row = {
              id: pid,
              title: null,
              low_variants_count: 0,
              low_variants: [],
            };
            productsOut.push(row);
          }
          row.low_variants_count += 1;
          row.low_variants.push({
            id: (v?.id ?? "") as string,
            title: (v?.title ?? null) as string | null,
            sku: (v?.sku ?? null) as string | null,
            inventory_quantity: qty,
          });
        }
      }
      if (batch.length < limit) {
        break;
      }
      offset += limit;
    }

    // Hydrate product titles
    for (const row of productsOut) {
      if (row.title) continue;
      try {
        const d = await http.get<{ product?: { id?: string; title?: string | null } }>(
          `/admin/products/${encodeURIComponent(row.id)}`,
          { fields: ["+id", "+title"].join(",") }
        );
        row.title = (d?.product?.title ?? null) as string | null;
      } catch {
        // ignore
      }
    }

    return {
      threshold,
      count: productsOut.length,
      variants_count: variantsCount,
      products: productsOut,
    };
  }

  return {
    countLowInventoryProducts,
    listLowInventoryProducts,
  };
}
