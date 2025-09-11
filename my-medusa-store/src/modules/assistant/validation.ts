// Pull a few commonly-used numeric fields from a payload as ground truth.
export function collectGroundTruthNumbers(
  payload: any
): Record<string, number> | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const keys = [
    "available",
    "available_quantity",
    "inventory_quantity",
    "stocked_quantity",
    "reserved_quantity",
    "count",
    "total",
    "orders",
    "items",
  ];

  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = (payload as any)[k];
    if (typeof v === "number") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

