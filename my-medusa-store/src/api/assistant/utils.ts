// Common utilities used by the assistant route

export function env(key: string): string | undefined {
  return (process.env as any)?.[key];
}

export function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence);
  return m ? m[1] : text;
}

export function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();
  // Try direct parse first
  try {
    return JSON.parse(stripped);
  } catch {}

  // Try object slice { ... }
  const firstObj = stripped.indexOf("{");
  const lastObj = stripped.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(stripped.slice(firstObj, lastObj + 1));
    } catch {}
  }

  // Try array slice [ ... ]
  const firstArr = stripped.indexOf("[");
  const lastArr = stripped.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(stripped.slice(firstArr, lastArr + 1));
    } catch {}
  }
  return undefined;
}

// MCP result: { content: [{ type:"text", text: "...json..." }], isError? }
export function extractToolJsonPayload(toolResult: any): any | undefined {
  try {
    const textItem = toolResult?.content?.find?.(
      (c: any) => c?.type === "text"
    );
    if (textItem?.text) return safeParseJSON(textItem.text);
  } catch {}
  return undefined;
}

// Normalize LLM tool args to match Medusa Admin expectations
export function normalizeToolArgs(input: any): any {
  const needsDollar = new Set([
    "gt",
    "gte",
    "lt",
    "lte",
    "eq",
    "ne",
    "in",
    "nin",
    "not",
    "like",
    "ilike",
    "re",
    "fulltext",
    "overlap",
    "contains",
    "contained",
    "exists",
    "and",
    "or",
  ]);

  const toNumberIfNumericString = (v: unknown) =>
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;

  const walk = (val: any, keyPath: string[] = []): any => {
    if (Array.isArray(val)) {
      const lastKey = keyPath[keyPath.length - 1];
      if (lastKey === "fields") return val.map(String).join(",");
      return val.map((v) => walk(v, keyPath));
    }
    if (val && typeof val === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const bare = k.replace(/^\$/g, "");
        const newKey = needsDollar.has(bare) ? `$${bare}` : k;
        out[newKey] = walk(v, [...keyPath, newKey]);
      }
      return out;
    }
    const last = keyPath[keyPath.length - 1];
    if (last === "limit" || last === "offset")
      return toNumberIfNumericString(val);
    return val;
  };

  return walk(input);
}
