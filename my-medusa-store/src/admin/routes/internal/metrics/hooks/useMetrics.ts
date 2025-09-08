import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMetrics } from "../lib/metricsApi";
import type { MetricsSummary, ToolStats } from "../types";
import { useLocalStorageState } from "../../../../hooks/useLocalStorageState";

const STORAGE_KEYS = {
autoRefresh: "metrics:autoRefresh",
intervalMs: "metrics:intervalMs",
} as const;


export function useMetrics() {
const [summary, setSummary] = useState<MetricsSummary | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);


const [autoRefresh, setAutoRefresh] = useLocalStorageState<boolean>(STORAGE_KEYS.autoRefresh, true);
const [intervalMs, setIntervalMs] = useLocalStorageState<number>(STORAGE_KEYS.intervalMs, 5000);


const load = useCallback(async () => {
setLoading(true);
setError(null);
try {
const data = await fetchMetrics();
setSummary(data);
} catch (e: any) {
setError(e?.message ?? String(e));
} finally {
setLoading(false);
}
}, []);


useEffect(() => {
load();
if (!autoRefresh) return;
const t = setInterval(load, Math.max(2000, Number(intervalMs) || 5000));
return () => clearInterval(t);
}, [load, autoRefresh, intervalMs]);


const tools = useMemo(() => Object.entries(summary?.byTool || {}) as [string, ToolStats][], [summary]);


return { summary, loading, error, autoRefresh, setAutoRefresh, intervalMs, setIntervalMs, tools, load } as const;
}