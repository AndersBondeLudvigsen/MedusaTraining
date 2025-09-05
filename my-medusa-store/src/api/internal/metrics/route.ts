import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { metricsStore } from "../../../lib/metrics/store";

function htmlEscape(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!)
  );
}

function renderHtml(summary: any) {
  const rows = Object.entries(summary.byTool)
    .map(
      ([tool, v]: any) => `
    <tr>
      <td>${htmlEscape(tool)}</td>
      <td>${v.total}</td>
      <td>${v.errors}</td>
      <td>${Math.round(v.avgLatency)} ms</td>
    </tr>`
    )
    .join("\n");

  const recent = summary.recentEvents
    .map(
      (e: any) => `
    <tr>
      <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td>${htmlEscape(e.tool)}</td>
      <td>${e.success ? "✅" : "❌"}</td>
      <td>${e.durationMs ?? ""}</td>
      <td><pre>${htmlEscape(
        typeof e.args === "string" ? e.args : JSON.stringify(e.args, null, 2)
      )}</pre></td>
      <td><pre>${htmlEscape(
        typeof e.result === "string"
          ? e.result
          : JSON.stringify(e.result, null, 2)
      )}</pre></td>
    </tr>`
    )
    .join("\n");

  const anomalies = summary.anomalies
    .map(
      (a: any) => `
    <li>[${new Date(a.timestamp).toLocaleTimeString()}] <strong>${htmlEscape(
        a.type
      )}</strong>: ${htmlEscape(a.message)}</li>
  `
    )
    .join("\n");

  const ratesRows = Object.entries(summary.rates.thisMinute)
    .map(([tool, count]: any) => {
      const base = summary.rates.baselineAvgPerMinute?.[tool] ?? 0;
      return `<tr><td>${htmlEscape(tool)}</td><td>${count}</td><td>${
        base.toFixed?.(2) ?? base
      }</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Internal Metrics</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
        th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
        th { background: #f8f8f8; text-align: left; }
        pre { white-space: pre-wrap; max-height: 160px; overflow: auto; }
        .note { color: #666; }
        .grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
      </style>
    </head>
    <body>
      <h1>Internal Metrics</h1>
      <p class="note">Same numbers used by the assistant. Append ?format=json for raw JSON.</p>
      <section>
        <h2>Totals (last hour window)</h2>
        <ul>
          <li>Total events recorded: ${summary.totals.totalEvents}</li>
          <li>Events in last hour: ${summary.totals.lastHour}</li>
        </ul>
      </section>
      <section>
        <h2>Rates (current vs baseline)</h2>
        <table>
          <thead><tr><th>Tool</th><th>This minute</th><th>Baseline avg/min (last ${10} min)</th></tr></thead>
          <tbody>${
            ratesRows || '<tr><td colspan="3">No calls yet</td></tr>'
          }</tbody>
        </table>
      </section>
      <section>
        <h2>By Tool (last hour)</h2>
        <table>
          <thead><tr><th>Tool</th><th>Total</th><th>Errors</th><th>Avg Latency</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No data</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Recent Events</h2>
        <table>
          <thead><tr><th>Time</th><th>Tool</th><th>OK</th><th>ms</th><th>Args</th><th>Result</th></tr></thead>
          <tbody>${recent || '<tr><td colspan="6">No events</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Alerts</h2>
        <ul>${anomalies || "<li>No anomalies</li>"}</ul>
      </section>
    </body>
  </html>`;
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const format = (req.query?.format as string) || (req.query?.f as string);
  const summary = metricsStore.getSummary();
  if (format === "json") return res.json(summary);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(renderHtml(summary));
}
