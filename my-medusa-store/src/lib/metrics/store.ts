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

export type Anomaly = {
  id: string;
  timestamp: number;
  type: "negative-inventory" | "spike" | "high-error-rate";
  message: string;
  details?: any;
};

const MAX_EVENTS = 1000;
const MAX_ANOMALIES = 200;
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

// Extract JSON payload from MCP-like result: { content:[{type:"text", text:"..."}], isError? }
function extractToolJsonPayload(toolResult: any): any | undefined {
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
  const findings: Array<{ path: string; value: number }> = [];
  const NEG_KEYS = new Set([
    "inventory",
    "inventory_quantity",
    "inventory_qty",
    "stock",
    "stock_level",
    "available",
    "available_quantity",
    "available_qty",
    "quantity",
    "qty",
  ]);

  const walk = (node: any, path: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, String(i)]));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const p = [...path, k];
      if (NEG_KEYS.has(k) && typeof v === "number" && v < 0) {
        findings.push({ path: p.join("."), value: v });
      }
      if (v && typeof v === "object") walk(v as any, p);
    }
  };
  walk(payload, []);
  return findings;
}

class MetricsStore {
  private events: ToolCallEvent[] = [];
  private anomalies: Anomaly[] = [];

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

  endToolCall(id: string, result: any, ok: boolean, errorMessage?: string) {
    const idx = this.events.findIndex((e) => e.id === id);
    const now = Date.now();
    if (idx === -1) return;
    const evt = this.events[idx];
    evt.success = ok;
    evt.errorMessage = ok ? undefined : errorMessage ?? "";
    evt.durationMs = now - evt.timestamp;
    evt.result = this.sanitize(result, 10000); // keep larger for results
    // parse payload for anomaly detection
    try {
      evt.parsedPayload = extractToolJsonPayload(result);
    } catch {}

    // anomaly checks
    this.checkAnomaliesAfterEvent(evt);
  }

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
    for (const [tool, b] of Object.entries(baseline)) {
      b.n = SPIKE_WINDOW_MIN;
      b.avg = b.n ? b.sum / b.n : 0;
    }

    const recentEvents = this.events.slice(-50);

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
    };
  }

  getEvents() {
    return this.events.slice();
  }

  getAnomalies() {
    return this.anomalies.slice();
  }

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
            message: `Negative inventory detected in ${evt.tool} result (${negs.length} fields)`,
            details: { fields: negs.slice(0, 10) },
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

  private sanitize(obj: any, maxLen = 3000) {
    try {
      const json = JSON.stringify(obj, (k, v) => {
        if (typeof v === "string" && v.length > 1000)
          return v.slice(0, 1000) + "…";
        if (Array.isArray(v) && v.length > 200)
          return v.slice(0, 200).concat(["…truncated…"]);
        return v;
      });
      if (json.length > maxLen) return json.slice(0, maxLen) + "…";
      return JSON.parse(json);
    } catch {
      const s = String(obj ?? "");
      return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
    }
  }
}

export const metricsStore = new MetricsStore();

// Convenience logger
export function withToolLogging<T>(
  tool: string,
  args: any,
  fn: () => Promise<T>
): Promise<T> {
  const id = metricsStore.startToolCall(tool, args);
  const start = Date.now();
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
