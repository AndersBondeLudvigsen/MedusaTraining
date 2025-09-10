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


export type AdminShippingMethodMaybe = {
    id?: string;
    name?: string | null;
    amount?: number;
    total?: number;
    subtotal?: number;
    shipping_option_id?: string | null;
    shipping_option?: { id?: string; name?: string | null } | null;

};

export type AdminOrderMinimal = {
    id?: string;
    created_at?: string;
    canceled_at?: string | null;

    items?: AdminOrderItemMaybe[]; // present on detail; sometimes on list depending on setup
    shipping_methods?: AdminShippingMethodMaybe[]; // present on detail
};

export type VariantResolution = {
    product_id?: string;
    title?: string | null;
    sku?: string | null;
};


