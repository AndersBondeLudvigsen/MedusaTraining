export type AdminVariantMaybe = {
    id?: string;
    product_id?: string;
    product?: { id?: string; title?: string } | null;
    sku?: string | null;
    title?: string | null;
};

export type AdminOrderItemMaybe = {
    id?: string;
    quantity?: number;
    unit_price?: number;
    total?: number;
    title?: string | null;
    sku?: string | null;
    variant_id?: string | null;
    product_id?: string | null;
    variant?: AdminVariantMaybe | null; // when expanded/detail
};

/** Minimal fields we read from order.shipping_methods[] */
export type AdminShippingMethodMaybe = {
    id?: string;
    name?: string | null;
    amount?: number | null; // per your JSON
    total?: number | null; // also present, we prefer total when available
    shipping_option_id?: string | null;
};

/** Minimal fields we read from order.fulfillments[] */
export type AdminFulfillmentMaybe = {
    id?: string;
    provider_id?: string | null; // e.g. "manual_manual"
    provider?: { id?: string } | null;
    shipping_option_id?: string | null;
    shipping_option?: { id?: string } | null;
};

export type AdminOrderMinimal = {
    id?: string;
    created_at?: string;
    canceled_at?: string | null;
    items?: AdminOrderItemMaybe[]; // present on detail; sometimes on list

    // NEW: make these optional so widening is backwards-safe
    shipping_methods?: AdminShippingMethodMaybe[]; // from order.shipping_methods
    fulfillments?: AdminFulfillmentMaybe[]; // from order.fulfillments
};

export type VariantResolution = {
    product_id?: string;
    title?: string | null;
    sku?: string | null;
};
