import { ChartSpec, ChartType, HistoryEntry } from "./types";
import { extractToolJsonPayload, safeParseJSON, stripJsonFences } from "./utils";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const X_PRIORITIES = [
  "month",
  "label",
  "date",
  "day",
  "bucket",
  "name",
  "email",
  "id",
  "year",
];
const Y_PRIORITIES = [
  "count",
  "order count",
  "orders count",
  "number of orders",
  "total",
  "amount",
  "revenue",
  "value",
  "quantity",
  "orders",
  "customers",
  "items",
  "sum",
  "avg",
  "median",
  "min",
  "max",
];

const isObj = (v: any): v is Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v);

// Depth-first: first array of objects we can chart
function findArrayOfObjects(node: any, depth = 0): any[] | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(node) && node.length && isObj(node[0])) return node;
  if (!isObj(node)) return undefined;
  for (const v of Object.values(node)) {
    const found = findArrayOfObjects(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function monthify(key: string, v: any): any {
  if (key === "month" && typeof v === "number" && v >= 1 && v <= 12) {
    return MONTHS_SHORT[(v - 1 + 12) % 12];
  }
  return v;
}

function pickXY(row: Record<string, any>) {
  const keys = Object.keys(row);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const keyByNorm: Record<string, string> = Object.fromEntries(keys.map((k) => [norm(k), k]));

  // Prefer known x candidates first
  let xKey = undefined as string | undefined;
  for (const cand of X_PRIORITIES) {
    const hit = keyByNorm[norm(cand)];
    if (hit && (typeof row[hit] === "string" || typeof row[hit] === "number")) {
      xKey = hit;
      break;
    }
  }
  if (!xKey) {
    xKey = keys.find((k) => typeof row[k] !== "number");
  }

  // Y: numeric; try priorities with flexible matching
  let yKey = undefined as string | undefined;
  for (const cand of Y_PRIORITIES) {
    const hit = keyByNorm[norm(cand)];
    if (hit && typeof row[hit] === "number") {
      yKey = hit;
      break;
    }
  }
  if (!yKey) {
    yKey = keys.find((k) => k !== xKey && typeof row[k] === "number");
  }
  return { xKey, yKey };
}

/** If a tool already returns a chart spec, honor it. */
function coerceChartSpec(payload: any): ChartSpec | undefined {
  if (payload?.type === "chart" && Array.isArray(payload?.data)) {
    const s = payload as ChartSpec;
    if (s.chart === "bar" || s.chart === "line") return s;
  }
  return undefined;
}

/** If a tool returns a neutral series, use it. */
function chartFromSeries(
  payload: any,
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  const series = Array.isArray(payload?.series) ? payload.series : undefined;
  if (!series || !series.length || !isObj(series[0])) return undefined;

  const sample = series[0] as Record<string, any>;
  const xKey =
    typeof payload?.xKey === "string"
      ? payload.xKey
      : "label" in sample
      ? "label"
      : "x" in sample
      ? "x"
      : undefined;
  const yKey =
    typeof payload?.yKey === "string"
      ? payload.yKey
      : "count" in sample
      ? "count"
      : "y" in sample
      ? "y"
      : undefined;
  if (!xKey || !yKey) return undefined;

  const rows = series.slice(0, 100).map((r: any) => ({
    [xKey]: monthify(xKey, r[xKey]),
    [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
  }));

  return {
    type: "chart",
    chart: chartType,
    title: payload?.title || title || "Results",
    xKey,
    yKey,
    data: rows,
  };
}

/** NEW: generic-from-child-objects. */
function chartFromChildObjects(
  payload: any,
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (!isObj(payload)) return undefined;

  const entries = Object.entries(payload).filter(([_, v]) => isObj(v)) as [
    string,
    Record<string, any>
  ][];
  if (entries.length < 2 || entries.length > 24) return undefined;

  const Y = Y_PRIORITIES;
  let chosenY: string | undefined;
  for (const y of Y) {
    const hits = entries.filter(
      ([_, obj]) => typeof obj[y] === "number"
    ).length;
    if (hits >= Math.max(2, Math.ceil(entries.length / 2))) {
      chosenY = y;
      break;
    }
  }
  if (!chosenY) return undefined;

  const rows = entries.map(([key, obj]) => {
    let label: string | number | undefined =
      obj.label ??
      obj.name ??
      (obj.month != null ? monthify("month", obj.month) : undefined) ??
      obj.year;
    if (label == null) label = key;
    const yVal =
      typeof obj[chosenY!] === "number"
        ? obj[chosenY!]
        : Number(obj[chosenY!]) || 0;
    return { label, [chosenY!]: yVal };
  });

  if (!rows.length) return undefined;

  return {
    type: "chart",
    chart: chartType,
    title: title ?? "Results",
    xKey: "label",
    yKey: chosenY,
    data: rows,
  };
}

/** Generic fallback: root count OR any array of objects. */
function genericChartFromPayload(
  payload: any,
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (typeof payload?.count === "number") {
    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Total",
      xKey: "label",
      yKey: "count",
      data: [{ label: "Total", count: payload.count }],
    };
  }

  const fromChildren = chartFromChildObjects(payload, chartType, title);
  if (fromChildren) return fromChildren;

  const arr = findArrayOfObjects(payload);
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0] as Record<string, any>;
    const { xKey, yKey } = pickXY(first);
    if (!xKey || !yKey) return undefined;

    const rows = arr.slice(0, 24).map((r) => ({
      [xKey]: monthify(xKey, r[xKey]),
      [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
    }));

    return {
      type: "chart",
      chart: chartType,
      title: title ?? "Results",
      xKey,
      yKey,
      data: rows,
    };
  }

  return undefined;
}

/** Build chart from the most recent tool payload. */
export function buildChartFromLatestTool(
  history: HistoryEntry[],
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (!history.length) return undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const payload = extractToolJsonPayload(history[i]?.tool_result);
    if (!payload) continue;

    const explicit = coerceChartSpec(payload);
    if (explicit) return explicit;

    const fromSeries = chartFromSeries(payload, chartType, title);
    if (fromSeries) return fromSeries;

    const generic = genericChartFromPayload(payload, chartType, title);
    if (generic) return generic;
  }
  return undefined;
}

/** Helper: find a case/format-insensitive match for a label among object keys */
function findKeyByLabel(sample: Record<string, any>, label?: string): string | undefined {
  if (!label) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(label);
  for (const k of Object.keys(sample)) {
    if (norm(k) === target) return k;
  }
  return undefined;
}

/** Try to coerce from common chart JSON like { chart_data: [], chart_type, chart_title, x_axis_label, y_axis_label } */
function chartFromCommonChartJson(
  payload: any,
  fallbackType: ChartType,
  fallbackTitle?: string
): ChartSpec | undefined {
  const arr = Array.isArray(payload?.chart_data) ? payload.chart_data : undefined;
  if (!arr || !arr.length || typeof arr[0] !== "object") return undefined;

  const sample = arr[0] as Record<string, any>;

  // Resolve x/y keys
  let xKey = findKeyByLabel(sample, payload?.x_axis_label);
  let yKey = findKeyByLabel(sample, payload?.y_axis_label);

  if (!xKey) {
    // Prefer known x candidates
    xKey = X_PRIORITIES.find((k) => k in sample && (typeof sample[k] === "string" || typeof sample[k] === "number"));
  }
  if (!xKey) {
    // Fallback to first non-numeric field
    xKey = Object.keys(sample).find((k) => typeof sample[k] !== "number");
  }

  if (!yKey) {
    // Try Y priorities with flexible matching, including keys with spaces
    const keys = Object.keys(sample);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const keyByNorm: Record<string, string> = Object.fromEntries(keys.map((k) => [norm(k), k]));
    for (const cand of Y_PRIORITIES) {
      const hit = keyByNorm[norm(cand)];
      if (hit && typeof sample[hit] === "number") {
        yKey = hit;
        break;
      }
    }
  }
  if (!yKey) {
    // Fallback to first numeric field not equal to xKey
    yKey = Object.keys(sample).find((k) => k !== xKey && typeof sample[k] === "number");
  }

  if (!xKey || !yKey) return undefined;

  // Sanitize keys for Recharts: avoid spaces/special chars in dataKey
  const makeSafe = (k: string) => (/^[-_a-zA-Z0-9]+$/.test(k) ? k : (k === xKey ? "label" : "value"));
  const safeX = makeSafe(xKey);
  const safeY = makeSafe(yKey);

  const rows = (arr as any[]).slice(0, 100).map((r) => ({
    [safeX]: monthify(safeX, r[xKey!]),
    [safeY]: typeof r[yKey!] === "number" ? r[yKey!] : Number(r[yKey!]) || 0,
  }));

  const type = payload?.chart_type === "line" || payload?.chart_type === "bar" ? payload.chart_type : fallbackType;
  const title = payload?.chart_title || fallbackTitle || "Results";

  return { type: "chart", chart: type, title, xKey: safeX, yKey: safeY, data: rows };
}

/** Build chart from the LLM final text answer if it embedded a chart JSON. */
export function buildChartFromAnswer(
  answer: string | undefined,
  chartType: ChartType,
  title?: string
): ChartSpec | undefined {
  if (!answer) return undefined;
  const maybe = safeParseJSON(stripJsonFences(answer));
  if (!maybe) return undefined;

  // If it already matches our ChartSpec, accept it
  const explicit = coerceChartSpec(maybe);
  if (explicit) return explicit;

  // If the answer is a top-level array of objects, infer a chart
  if (Array.isArray(maybe) && maybe.length && typeof maybe[0] === "object") {
    const first = maybe[0] as Record<string, any>;
    const { xKey, yKey } = pickXY(first);
    if (xKey && yKey) {
      const rows = (maybe as any[]).slice(0, 24).map((r) => ({
        [xKey]: monthify(xKey, r[xKey]),
        [yKey]: typeof r[yKey] === "number" ? r[yKey] : Number(r[yKey]) || 0,
      }));
      return {
        type: "chart",
        chart: chartType,
        title: title || "Results",
        xKey,
        yKey,
        data: rows,
      };
    }
  }

  // Try common chart JSON formats
  const fromCommon = chartFromCommonChartJson(maybe, chartType, title);
  if (fromCommon) return fromCommon;

  // As a last resort, try the generic fallback on this JSON
  return genericChartFromPayload(maybe, chartType, title);
}
