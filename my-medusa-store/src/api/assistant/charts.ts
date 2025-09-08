import { ChartSpec, ChartType, HistoryEntry } from "./types";
import { extractToolJsonPayload } from "./utils";

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
  let xKey = X_PRIORITIES.find(
    (k) =>
      k in row && (typeof row[k] === "string" || typeof row[k] === "number")
  );
  let yKey = Y_PRIORITIES.find((k) => k in row && typeof row[k] === "number");
  if (!xKey)
    xKey = Object.keys(row).find(
      (k) => typeof row[k] === "string" || typeof row[k] === "number"
    );
  if (!yKey)
    yKey = Object.keys(row).find(
      (k) => typeof row[k] === "number" && k !== xKey
    );
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
