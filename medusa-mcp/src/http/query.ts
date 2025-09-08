export function toBracketParams(
  obj: Record<string, unknown>,
  prefix = ""
): [string, string][] {
  const out: [string, string][] = [];
  const push = (k: string, v: unknown) => {
    if (v != null) out.push([k, String(v)]);
  };
  for (const [key, value] of Object.entries(obj)) {
    const k = prefix ? `${prefix}[${key}]` : key;
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => push(k, v));
    else if (typeof value === "object")
      out.push(...toBracketParams(value as Record<string, unknown>, k));
    else push(k, value);
  }
  return out;
}

export function withQuery(
  path: string,
  queryObj: Record<string, unknown>
): string {
  const pairs = toBracketParams(queryObj);
  return pairs.length
    ? `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(pairs)}`
    : path;
}
