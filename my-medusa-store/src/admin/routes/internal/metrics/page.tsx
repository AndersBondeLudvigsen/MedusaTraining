import { useEffect, useMemo, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Button, Container, Heading, Text, Badge } from "@medusajs/ui";
import { Beaker } from "@medusajs/icons";

/* ---------------- Types (aligns with /internal/metrics response) ---------------- */

type ToolStats = { total: number; errors: number; avgLatency: number };

type ToolEvent = {
  id: string;
  timestamp: number;
  tool: string;
  args: any;
  result?: any;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
};

type Anomaly = {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  details?: any;
};

type NumberDelta = { ai: number; tool: number; diff: number; withinTolerance: boolean };

type ValidationCheck = {
  label: string;
  ai?: number;
  tool?: number;
  tolerance?: number;
  delta?: NumberDelta;
  ok: boolean;
};

type AssistantTurn = {
  id: string;
  timestamp: number;
  userMessage: any;
  assistantMessage?: any;
  toolsUsed: string[];
  extractedNumbers?: Record<string, number>;
  groundedNumbers?: Record<string, number>;
  validations: ValidationCheck[];
};

type AssistantSummary = {
  turns: AssistantTurn[];
  validation: { total: number; ok: number; fail: number };
};

type MetricsSummary = {
  totals: { totalEvents: number; lastHour: number };
  byTool: Record<string, ToolStats>;
  rates: {
    thisMinute: Record<string, number>;
    baselineAvgPerMinute: Record<string, number>;
  };
  recentEvents: ToolEvent[];
  anomalies: Anomaly[];
  assistant?: AssistantSummary;
};

/* ---------------- Utils ---------------- */

const formatMs = (v?: number) =>
  typeof v === "number" ? `${Math.round(v)} ms` : "";
const timeStr = (ts: number) => new Date(ts).toLocaleTimeString();

function jsonPreview(v: unknown, max = 400) {
  const s = JSON.stringify(v, null, 2);
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function numberOrDash(v: unknown) {
  return typeof v === "number" && !Number.isNaN(v) ? String(v) : "—";
}

/* ---------------- Page ---------------- */

const MetricsPage = () => {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalMs, setIntervalMs] = useState(5000);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/internal/metrics?format=json", {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSummary(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, Math.max(2000, intervalMs));
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, intervalMs]);

  const tools = useMemo(() => Object.entries(summary?.byTool || {}), [summary]);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">AI Metrics</Heading>
      </div>

      <div className="px-6 py-4 grid gap-4">
        <Text size="small">
          Observability for the assistant: tool calls, rates, errors, alerts — plus
          assistant turn validations against grounded numbers.
        </Text>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            variant="secondary"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto refresh</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-ui-fg-subtle">Every</span>
            <select
              className="rounded border p-1 bg-ui-bg-base"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value) || 5000)}
              disabled={!autoRefresh}
            >
              <option value={3000}>3s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
          </label>
          <a
            className="text-ui-link hover:underline ml-auto"
            href="/internal/metrics?format=json"
            target="_blank"
            rel="noreferrer"
          >
            Open raw JSON
          </a>
        </div>

        {error && <div className="text-ui-fg-error">Error: {error}</div>}

        {/* Totals */}
        <section className="grid gap-1">
          <Heading level="h2">Totals (last hour)</Heading>
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-ui-fg-subtle">Total events:</span>{" "}
              <span className="font-medium">
                {summary?.totals.totalEvents ?? 0}
              </span>
            </div>
            <div>
              <span className="text-ui-fg-subtle">Events in last hour:</span>{" "}
              <span className="font-medium">
                {summary?.totals.lastHour ?? 0}
              </span>
            </div>
          </div>
        </section>

        {/* Rates */}
        <section className="grid gap-2">
          <Heading level="h2">Rates (current vs baseline)</Heading>
          <div className="overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ui-bg-subtle text-left">
                  <th className="p-2">Tool</th>
                  <th className="p-2">This minute</th>
                  <th className="p-2">Baseline avg/min</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary?.rates.thisMinute || {}).length === 0 && (
                  <tr>
                    <td className="p-2" colSpan={3}>
                      No calls yet
                    </td>
                  </tr>
                )}
                {Object.entries(summary?.rates.thisMinute || {}).map(
                  ([tool, count]) => (
                    <tr key={tool} className="border-t">
                      <td className="p-2 whitespace-nowrap">{tool}</td>
                      <td className="p-2">{count as number}</td>
                      <td className="p-2">
                        {(
                          summary?.rates.baselineAvgPerMinute?.[tool] ?? 0
                        ).toFixed?.(2) ?? 0}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* By Tool */}
        <section className="grid gap-2">
          <Heading level="h2">By Tool (last hour)</Heading>
          <div className="overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ui-bg-subtle text-left">
                  <th className="p-2">Tool</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Errors</th>
                  <th className="p-2">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {tools.length === 0 && (
                  <tr>
                    <td className="p-2" colSpan={4}>
                      No data
                    </td>
                  </tr>
                )}
                {tools.map(([name, v]) => (
                  <tr key={name} className="border-t">
                    <td className="p-2 whitespace-nowrap">{name}</td>
                    <td className="p-2">{v.total}</td>
                    <td className="p-2">{v.errors}</td>
                    <td className="p-2">{formatMs(v.avgLatency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Alerts */}
        <section className="grid gap-2">
          <Heading level="h2">Alerts</Heading>
          <div className="border rounded-md p-2">
            {(summary?.anomalies?.length ?? 0) === 0 && (
              <Text size="small">No anomalies</Text>
            )}
            <ul className="grid gap-1">
              {summary?.anomalies?.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="text-ui-fg-subtle">
                    [{timeStr(a.timestamp)}]
                  </span>{" "}
                  <b>{a.type}</b>: {a.message}
                  {a.type === "negative-inventory" && a.details?.fields?.length ? (
                    <div className="mt-1 ml-4">
                      <details>
                        <summary className="cursor-pointer text-ui-fg-subtle">
                          {a.details?.scoped
                            ? "Scoped detection (inventory keys only)"
                            : "Detection details"}
                        </summary>
                        <ul className="list-disc ml-6 mt-1">
                          {a.details.fields.map((f: any, i: number) => (
                            <li key={i}>
                              <code>{f.path}</code>: {String(f.value)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Assistant Validation Summary */}
        <section className="grid gap-1">
          <Heading level="h2">Assistant — Validation Summary</Heading>
          {!summary?.assistant ? (
            <Text size="small">No assistant data yet</Text>
          ) : (
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-ui-fg-subtle">Checks:</span>{" "}
                <span className="font-medium">
                  {summary.assistant.validation.total}
                </span>
              </div>
              <div>
                <span className="text-ui-fg-subtle">OK:</span>{" "}
                <span className="font-medium text-ui-fg-success">
                  {summary.assistant.validation.ok}
                </span>
              </div>
              <div>
                <span className="text-ui-fg-subtle">Fail:</span>{" "}
                <span className="font-medium text-ui-fg-error">
                  {summary.assistant.validation.fail}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Assistant Recent Turns */}
        <section className="grid gap-2">
          <Heading level="h2">Assistant — Recent Turns</Heading>
          {!summary?.assistant?.turns?.length ? (
            <Text size="small">No turns yet</Text>
          ) : (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ui-bg-subtle text-left align-bottom">
                    <th className="p-2">Time</th>
                    <th className="p-2">Tools Used</th>
                    <th className="p-2">Grounded Numbers</th>
                    <th className="p-2">Extracted Numbers</th>
                    <th className="p-2">Validations</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.assistant.turns.map((t) => (
                    <tr key={t.id} className="border-t align-top">
                      <td className="p-2 whitespace-nowrap">{timeStr(t.timestamp)}</td>
                      <td className="p-2">
                        {t.toolsUsed?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {t.toolsUsed.map((name) => (
                              <Badge key={name} size="small" variant="secondary">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ui-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {t.groundedNumbers ? (
                          <pre className="max-h-40 overflow-auto">
                            {jsonPreview(t.groundedNumbers)}
                          </pre>
                        ) : (
                          <span className="text-ui-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {t.extractedNumbers ? (
                          <pre className="max-h-40 overflow-auto">
                            {jsonPreview(t.extractedNumbers)}
                          </pre>
                        ) : (
                          <span className="text-ui-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {!t.validations?.length ? (
                          <span className="text-ui-fg-subtle">—</span>
                        ) : (
                          <div className="overflow-auto">
                            <table className="min-w-[420px] text-xs border rounded-md">
                              <thead>
                                <tr className="bg-ui-bg-subtle text-left">
                                  <th className="p-1">Label</th>
                                  <th className="p-1">AI</th>
                                  <th className="p-1">Tool</th>
                                  <th className="p-1">Diff</th>
                                  <th className="p-1">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.validations.map((v, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="p-1">{v.label}</td>
                                    <td className="p-1">{numberOrDash(v.ai)}</td>
                                    <td className="p-1">{numberOrDash(v.tool)}</td>
                                    <td className="p-1">
                                      {typeof v?.delta?.diff === "number"
                                        ? v.delta.diff
                                        : "—"}
                                    </td>
                                    <td className="p-1">
                                      {v.ok ? (
                                        <Badge size="small" variant="green">OK</Badge>
                                      ) : (
                                        <Badge size="small" variant="red">FAIL</Badge>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent Events */}
        <section className="grid gap-2">
          <Heading level="h2">Recent Events</Heading>
          <div className="overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ui-bg-subtle text-left">
                  <th className="p-2">Time</th>
                  <th className="p-2">Tool</th>
                  <th className="p-2">OK</th>
                  <th className="p-2">ms</th>
                  <th className="p-2">Args</th>
                  <th className="p-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.recentEvents?.length ?? 0) === 0 && (
                  <tr>
                    <td className="p-2" colSpan={6}>
                      No events
                    </td>
                  </tr>
                )}
                {summary?.recentEvents?.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap">
                      {timeStr(e.timestamp)}
                    </td>
                    <td className="p-2 whitespace-nowrap">{e.tool}</td>
                    <td className="p-2">{e.success ? "✅" : "❌"}</td>
                    <td className="p-2">{e.durationMs ?? ""}</td>
                    <td className="p-2">
                      <pre className="max-h-40 overflow-auto">
                        {JSON.stringify(e.args, null, 2)}
                      </pre>
                    </td>
                    <td className="p-2">
                      <pre className="max-h-40 overflow-auto">
                        {JSON.stringify(e.result, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({ label: "AI Metrics", icon: Beaker });
export default MetricsPage;
