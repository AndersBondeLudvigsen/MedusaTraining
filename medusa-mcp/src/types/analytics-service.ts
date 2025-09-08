import type { AdminOrderMinimal, VariantResolution } from "./medusa-admin";

export type OrdersRepo = {
  listInRange: (s: string, e: string) => Promise<AdminOrderMinimal[]>;
  withItems: (s: string, e: string) => Promise<AdminOrderMinimal[]>;
};
export type VariantsRepo = {
  resolve: (variantId: string) => Promise<VariantResolution>;
};
