import crypto from "node:crypto";

export type ToolCallEvent = {
  id: string;
  timestamp: number; // ms epoch
  tool: string;
  args: any;
  result?: any;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  parsedPayload?: any;
};

export type NumberDelta = {
  ai: number;
  tool: number;
  diff: number;
  withinTolerance: boolean;
};

export type ValidationCheck = {
  label: string; // e.g., "available_seats"
  ai?: number; // number claimed by the assistant
  tool?: number; // ground truth from a tool
  tolerance?: number; // absolute tolerance allowed, default 0
  delta?: NumberDelta; // computed diff
  ok: boolean; // validation result
};

export type AssistantTurn = {
  id: string;
  timestamp: number; // ms epoch
  userMessage: any; // sanitized
  assistantMessage?: any; // sanitized
  toolsUsed: string[]; // tool names the model invoked
  extractedNumbers?: Record<string, number>; // from assistantMessage (best-effort)
  groundedNumbers?: Record<string, number>; // supplied by your code from tools
  validations: ValidationCheck[]; // results
};

export type Anomaly = {
  id: string;
  timestamp: number;
  type:
    | "negative-inventory"
    | "spike"
    | "high-error-rate"
    | "ai-mismatch"
    | "ai-no-tool-used";
  message: string;
  details?: any;
};

const MAX_EVENTS = 1000;
const MAX_ANOMALIES = 200;
const MAX_TURNS = 300;
const SPIKE_WINDOW_MIN = 10; // minutes for baseline
const SPIKE_FACTOR = 3; // 3x baseline
const SPIKE_MIN_ABS = 10; // at least 10 calls in the burst minute

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = text?.match?.(fence as any);
  return m ? m[1] : text;
}

function safeParseJSON(maybeJson: unknown): any | undefined {
  if (typeof maybeJson !== "string") return undefined;
  const stripped = stripJsonFences(maybeJson).trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return undefined;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

function extractToolJsonPayload(toolResult: any): any | undefined {
  if (toolResult && typeof toolResult === "object") return toolResult;
  try {
    const textItem = toolResult?.content?.find?.(
      (c: any) => c?.type === "text"
    );
    if (textItem?.text) return safeParseJSON(textItem.text);
  } catch {}
  return undefined;
}

function generateId() {
  return (
    crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

// Heuristic: detect negative inventory quantities in a JSON payload
function detectNegativeInventory(payload: any) {
  // Only scan a narrow set of inventory-related keys and avoid generic fields like quantity/qty.
  const findings: Array<{ path: string; value: number }> = [];

  // Keys validated against MCP OAS/types for inventory levels/variants
  // - inventory levels: stocked_quantity, reserved_quantity, available_quantity, incoming_quantity
  // - variants: inventory_quantity (only when requested in fields)
  const INVENTORY_KEYS = new Set([
    "stocked_quantity",
    "reserved_quantity",
    "available_quantity",
    "incoming_quantity",
    "inventory_quantity",
  ]);

  // Exclude well-known non-inventory contexts (orders, returns, discounts, refunds, adjustments)
  const EXCLUDED_PATHS: RegExp[] = [
    /(^|\.)orders?(\.|$)/i,
    /(^|\.)order(\.|$)/i,
    /(^|\.)returns?(\.|$)/i,
    /(^|\.)refunds?(\.|$)/i,
    /(^|\.)discounts?(\.|$)/i,
    /(^|\.)adjustments?(\.|$)/i,
  ];

  const isExcluded = (pathStr: string) =>
    EXCLUDED_PATHS.some((r) => r.test(pathStr));

  const walk = (node: any, path: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, String(i)]));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const p = [...path, k];
      const pathStr = p.join(".");
      if (
        !isExcluded(pathStr) &&
        INVENTORY_KEYS.has(k) &&
        typeof v === "number" &&
        v < 0
      ) {
        findings.push({ path: pathStr, value: v });
      }
      if (v && typeof v === "object") walk(v as any, p);
    }
  };
  walk(payload, []);
  return findings;
}

/* --------------------------- Secret redaction --------------------------- */

type Redaction = {
  pattern: RegExp;
  replace?: string | ((m: string) => string);
};

// Conservative patterns; extend with provider-specific ones if needed.
const SECRET_PATTERNS: Redaction[] = [
  // Bearer tokens / Authorization headers
  {
    pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi,
    replace: "Bearer ***REDACTED***",
  },
  // JWT (three dot-separated Base64URL segments)
  {
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: "***REDACTED_JWT***",
  },
  // OpenAI-like "sk-" keys
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: "***REDACTED_KEY***" },
  // Generic key/value tokens in text
  {
    pattern:
      /\b(?:api[-_]?key|access[-_]?key|secret|token|pat|session|authorization)\b\s*[:=]\s*["']?([A-Za-z0-9._-]{20,})/gi,
    replace: (m) => m.replace(/([A-Za-z0-9._-]{20,})$/g, "***REDACTED***"),
  },
  // URL query params that often carry secrets
  {
    pattern:
      /([?&](?:api[_-]?key|key|token|access[_-]?token|auth|signature|sig)=)[^&#\s]+/gi,
    replace: (m) => m.replace(/=.*/g, "=***REDACTED***"),
  },
];

const SENSITIVE_VALUE_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "api-key",
  "apikey",
  "access-key",
  "accesskey",
  "secret",
  "client-secret",
  "token",
  "id-token",
  "refresh-token",
  "password",
  "pass",
  "pwd",
  "private-key",
  "privatekey",
  "x-api-key",
  "x-auth-token",
]);

/** Redact secrets inside a free-form string */
function redactStrings(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    out = out.replace(pattern, (m: string) =>
      typeof replace === "function" ? replace(m) : replace ?? "***REDACTED***"
    );
  }

  // Generic long base64/hex-ish tokens (last resort). Only if length >= 32 and mixed classes.
  out = out.replace(/\b[A-Za-z0-9+/_-]{32,}\b/g, (m) => {
    const hasLetters = /[A-Za-z]/.test(m);
    const hasDigits = /\d/.test(m);
    if (hasLetters && hasDigits) return "***REDACTED***";
    return m;
  });

  return out;
}

/** Deep clone+redact an object, handling cycles and preserving arrays/shape */
function redactObjectDeep<T>(value: T): T {
  const seen = new WeakMap<object, any>();

  const walk = (val: any): any => {
    if (val == null) return val;
    const t = typeof val;

    if (t === "string") return redactStrings(val);
    if (t !== "object") return val;

    if (seen.has(val)) return seen.get(val);

    if (Array.isArray(val)) {
      const arr: any[] = new Array(val.length);
      seen.set(val, arr);
      for (let i = 0; i < val.length; i++) arr[i] = walk(val[i]);
      return arr;
    }

    const out: Record<string, any> = {};
    seen.set(val, out);

    for (const [k, v] of Object.entries(val)) {
      const lowerK = k.toLowerCase();
      if (SENSITIVE_VALUE_KEYS.has(lowerK)) {
        out[k] = "***REDACTED***";
        continue;
      }
      out[k] = walk(v);
    }

    return out;
  };

  return walk(value);
}

/* ------------------------- End secret redaction ------------------------- */

/* ------------------------ Assistant parsing helpers ------------------------ */

/** Extract first integer/float that follows a given label (simple heuristic). */
function extractLabeledNumber(text: string, label: string): number | undefined {
  const re = new RegExp(`${label}\\D*(-?\\d+(?:[\\.,]\\d+)?)`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  return Number(String(m[1]).replace(",", "."));
}

/** Extract any standalone numbers with lightweight labels (e.g., "seats: 12"). */
function extractAnyNumbers(text: string): Record<string, number> {
  const found: Record<string, number> = {};
  // pattern: key: value OR key value
  const re = /\b([a-z][a-z0-9_\- ]{2,20})[: ]\s*(-?\d+(?:[.,]\d+)?)(?![%\w])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    const num = Number(m[2].replace(",", "."));
    if (!Number.isNaN(num)) found[key] = num;
  }
  // Also catch bare numbers labeled “total|count|available|seats|items”
  const re2 = /\b(total|count|available|seats|items)\D*(-?\d+(?:[.,]\d+)?)/gi;
  while ((m = re2.exec(text))) {
    const key = m[1].toLowerCase();
    const num = Number(m[2].replace(",", "."));
    if (!(key in found) && !Number.isNaN(num)) found[key] = num;
  }
  return found;
}

/* ---------------------- End assistant parsing helpers ---------------------- */

class MetricsStore {
  private events: ToolCallEvent[] = [];
  private anomalies: Anomaly[] = [];
  private turns: AssistantTurn[] = [];

  /* ------------------------------ Tools logging ------------------------------ */

  startToolCall(tool: string, args: any): string {
    const id = generateId();
    const evt: ToolCallEvent = {
      id,
      timestamp: Date.now(),
      tool,
      args: this.sanitize(args),
      success: false,
    };
    this.pushEvent(evt);
    return id;
  }

  endToolCall(id: string, rawResult: any, ok: boolean, errorMessage?: string) {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const evt = this.events[idx];

    // Extract BEFORE sanitize
    try {
      evt.parsedPayload =
        extractToolJsonPayload(rawResult) ??
        (typeof rawResult === "object" ? rawResult : undefined);
    } catch {}

    evt.success = ok;
    evt.errorMessage = ok ? undefined : errorMessage ?? "";
    evt.durationMs = Date.now() - evt.timestamp;
    evt.result = this.sanitize(rawResult, 10_000);

    this.checkAnomaliesAfterEvent(evt);
  }

  /* --------------------------- Assistant turn logging --------------------------- */

  /** Begin an assistant turn (call when a user message arrives). */
  startAssistantTurn(userMessage: any): string {
    const id = generateId();
    const turn: AssistantTurn = {
      id,
      timestamp: Date.now(),
      userMessage: this.sanitize(userMessage),
      toolsUsed: [],
      validations: [],
    };
    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS)
      this.turns.splice(0, this.turns.length - MAX_TURNS);
    return id;
  }

  /** Record that a tool was used during a given turn (optional but useful). */
  noteToolUsed(turnId: string, toolName: string) {
    const t = this.turns.find((x) => x.id === turnId);
    if (!t) return;
    if (!t.toolsUsed.includes(toolName)) t.toolsUsed.push(toolName);
  }

  /** Finish an assistant turn with the final assistant message. */
  endAssistantTurn(turnId: string, assistantMessage: any) {
    const t = this.turns.find((x) => x.id === turnId);
    if (!t) return;
    t.assistantMessage = this.sanitize(assistantMessage);

    // Attempt to extract numeric claims from the raw text (best-effort).
    try {
      const text =
        typeof assistantMessage === "string"
          ? assistantMessage
          : assistantMessage?.content ??
            assistantMessage?.text ??
            JSON.stringify(assistantMessage);
      if (typeof text === "string") {
        t.extractedNumbers = extractAnyNumbers(text);
      }
    } catch {}

    // Optional anomaly: numeric claims but no tools used
    if (
      t.extractedNumbers &&
      Object.keys(t.extractedNumbers).length > 0 &&
      t.toolsUsed.length === 0
    ) {
      this.pushAnomaly({
        id: generateId(),
        timestamp: Date.now(),
        type: "ai-no-tool-used",
        message: "Assistant produced numeric claims without using tools",
        details: { turnId: t.id, claims: t.extractedNumbers },
      });
    }
  }

  /** Provide ground-truth numbers from tools for this turn. */
  provideGroundTruth(turnId: string, numbers: Record<string, number>) {
    const t = this.turns.find((x) => x.id === turnId);
    if (!t) return;
    t.groundedNumbers = { ...(t.groundedNumbers ?? {}), ...numbers };
  }

  /** Validate a single labeled number (explicit). */
  validateNumber(
    turnId: string,
    label: string,
    ai: number | undefined,
    tool: number | undefined,
    tolerance = 0
  ) {
    const t = this.turns.find((x) => x.id === turnId);
    if (!t) return;

    const delta: NumberDelta | undefined =
      ai != null && tool != null
        ? {
            ai,
            tool,
            diff: ai - tool,
            withinTolerance: Math.abs(ai - tool) <= Math.abs(tolerance),
          }
        : undefined;

    const ok = !!delta && delta.withinTolerance;

    const check: ValidationCheck = { label, ai, tool, tolerance, delta, ok };
    t.validations.push(check);

    // Anomaly for mismatch
    if (tool != null && ai != null && !ok) {
      this.pushAnomaly({
        id: generateId(),
        timestamp: Date.now(),
        type: "ai-mismatch",
        message: `AI mismatch on "${label}": AI=${ai}, TOOL=${tool}, tol=${tolerance}`,
        details: { turnId, label, ai, tool, tolerance, diff: delta?.diff },
      });
    }
  }

  /** Convenience: extract AI’s claim for the label from its final text, then validate. */
  autoValidateFromAnswer(
    turnId: string,
    label: string,
    tool: number,
    tolerance = 0
  ) {
    const t = this.turns.find((x) => x.id === turnId);
    if (!t) return;

    let ai: number | undefined;

    // Prefer structured extraction if we already parsed numbers
    if (t.extractedNumbers && label in t.extractedNumbers) {
      ai = t.extractedNumbers[label];
    } else {
      // Fallback: search in assistant message text
      const raw =
        typeof t.assistantMessage === "string"
          ? t.assistantMessage
          : JSON.stringify(t.assistantMessage);
      ai =
        typeof raw === "string" ? extractLabeledNumber(raw, label) : undefined;
    }

    this.validateNumber(turnId, label, ai, tool, tolerance);
  }

  /** Optional: get last turn (helper for orchestration code) */
  getLastTurn(): AssistantTurn | undefined {
    return this.turns[this.turns.length - 1];
  }

  /* --------------------------------- Summary -------------------------------- */

  getSummary() {
    const now = Date.now();
    const total = this.events.length;
    const windowStart = now - 60 * 60 * 1000; // last hour
    const lastHour = this.events.filter((e) => e.timestamp >= windowStart);
    const byTool: Record<
      string,
      { total: number; errors: number; avgLatency: number }
    > = {};

    for (const e of lastHour) {
      const b = (byTool[e.tool] ??= { total: 0, errors: 0, avgLatency: 0 });
      b.total++;
      if (!e.success) b.errors++;
      if (e.durationMs != null) {
        // incremental average
        b.avgLatency += (e.durationMs - b.avgLatency) / b.total;
      }
    }

    // spike detection overview (current minute)
    const currentMinute = Math.floor(now / 60000);
    const countsThisMinute: Record<string, number> = {};
    const baseline: Record<string, { sum: number; n: number; avg: number }> =
      {};

    for (const e of this.events) {
      const m = Math.floor(e.timestamp / 60000);
      const bt = (baseline[e.tool] ??= { sum: 0, n: 0, avg: 0 });
      // build baseline over last SPIKE_WINDOW_MIN minutes excluding current minute
      if (m >= currentMinute - SPIKE_WINDOW_MIN && m < currentMinute) {
        bt.sum += 1;
      }
      if (m === currentMinute) {
        countsThisMinute[e.tool] = (countsThisMinute[e.tool] ?? 0) + 1;
      }
    }
    for (const [, b] of Object.entries(baseline)) {
      b.n = SPIKE_WINDOW_MIN;
      b.avg = b.n ? b.sum / b.n : 0;
    }

    const recentEvents = this.events.slice(-50);

    // Assistant validation summary
    const lastTurns = this.turns.slice(-50);
    const validationTotals = lastTurns.reduce(
      (acc, t) => {
        for (const v of t.validations) {
          acc.total++;
          if (v.ok) acc.ok++;
          else acc.fail++;
        }
        return acc;
      },
      { total: 0, ok: 0, fail: 0 }
    );

    return {
      totals: { totalEvents: total, lastHour: lastHour.length },
      byTool,
      rates: {
        thisMinute: countsThisMinute,
        baselineAvgPerMinute: Object.fromEntries(
          Object.entries(baseline).map(([k, v]) => [k, v.avg])
        ),
      },
      recentEvents,
      anomalies: this.anomalies.slice(-50),
      assistant: {
        turns: lastTurns,
        validation: validationTotals,
      },
    };
  }

  getEvents() {
    return this.events.slice();
  }

  getAnomalies() {
    return this.anomalies.slice();
  }

  /* --------------------------------- Internals -------------------------------- */

  private pushEvent(evt: ToolCallEvent) {
    this.events.push(evt);
    if (this.events.length > MAX_EVENTS)
      this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private pushAnomaly(a: Anomaly) {
    this.anomalies.push(a);
    if (this.anomalies.length > MAX_ANOMALIES)
      this.anomalies.splice(0, this.anomalies.length - MAX_ANOMALIES);
  }

  private checkAnomaliesAfterEvent(evt: ToolCallEvent) {
    const now = Date.now();

    // negative inventory
    try {
      const payload = evt.parsedPayload;
      if (payload) {
        const negs = detectNegativeInventory(payload);
        if (negs.length) {
          this.pushAnomaly({
            id: generateId(),
            timestamp: now,
            type: "negative-inventory",
            message: `Negative inventory detected in ${evt.tool} result (${negs.length} fields) [scoped keys only]`,
            details: { fields: negs.slice(0, 10), scoped: true },
          });
        }
      }
    } catch {}

    // spike detection per tool
    try {
      const currentMinute = Math.floor(now / 60000);
      const counts: Record<number, number> = {};
      for (const e of this.events) {
        if (e.tool !== evt.tool) continue;
        const m = Math.floor(e.timestamp / 60000);
        counts[m] = (counts[m] ?? 0) + 1;
      }
      const thisMin = counts[currentMinute] ?? 0;
      let sum = 0;
      for (let i = 1; i <= SPIKE_WINDOW_MIN; i++)
        sum += counts[currentMinute - i] ?? 0;
      const avg = sum / SPIKE_WINDOW_MIN;
      if (thisMin >= SPIKE_MIN_ABS && avg > 0 && thisMin > avg * SPIKE_FACTOR) {
        this.pushAnomaly({
          id: generateId(),
          timestamp: now,
          type: "spike",
          message: `Spike in tool calls for ${
            evt.tool
          }: ${thisMin} this minute vs avg ${avg.toFixed(2)}`,
          details: { thisMinute: thisMin, baselineAvg: avg },
        });
      }
    } catch {}

    // high recent error rate (last 10 for same tool)
    try {
      const recent = this.events.filter((e) => e.tool === evt.tool).slice(-10);
      if (recent.length >= 10) {
        const errs = recent.filter((e) => !e.success).length;
        if (errs / recent.length >= 0.5) {
          this.pushAnomaly({
            id: generateId(),
            timestamp: now,
            type: "high-error-rate",
            message: `High error rate for ${evt.tool}: ${errs}/${recent.length} failures in last 10 calls`,
          });
        }
      }
    } catch {}
  }

  // Deep redaction + length limits with stable object shape
  private sanitize(obj: any, maxLen = 3000) {
    try {
      const redacted = redactObjectDeep(obj);

      const json = JSON.stringify(redacted, (k, v) => {
        if (typeof v === "string" && v.length > 1000)
          return v.slice(0, 1000) + "…";
        if (Array.isArray(v) && v.length > 200)
          return v.slice(0, 200).concat(["…truncated…"]);
        return v;
      });

      if (json.length <= maxLen) return JSON.parse(json);

      return { __truncated__: true, preview: json.slice(0, maxLen) + "…" };
    } catch {
      const s = redactStrings(String(obj ?? ""));
      return s.length <= maxLen
        ? { preview: s }
        : { __truncated__: true, preview: s.slice(0, maxLen) + "…" };
    }
  }
}

export const metricsStore = new MetricsStore();

export function withToolLogging<T>(
  tool: string,
  args: any,
  fn: () => Promise<T>
): Promise<T> {
  const id = metricsStore.startToolCall(tool, args);
  return fn()
    .then((res) => {
      metricsStore.endToolCall(id, res, true);
      return res;
    })
    .catch((err) => {
      metricsStore.endToolCall(
        id,
        err?.result ?? err,
        false,
        err?.message ?? String(err)
      );
      throw err;
    });
}
