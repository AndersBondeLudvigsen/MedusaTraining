import { useCallback, useMemo, useState } from "react";
import { useLocalStorageState } from "./useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import { askAssistant } from "../lib/assistantApi";
import type { Category } from "../types";
import type { ChartSpec } from "../ChartRenderer";


export function useAssistant() {
// persisted user prefs + prompt
const [prompt, setPrompt] = useLocalStorageState<string>(STORAGE_KEYS.prompt, "");
const [wantsChart, setWantsChart] = useLocalStorageState<boolean>(STORAGE_KEYS.wantsChart, false);
const [chartType, setChartType] = useLocalStorageState<"bar" | "line">(STORAGE_KEYS.chartType, "bar");
const [chartTitle, setChartTitle] = useLocalStorageState<string>(STORAGE_KEYS.chartTitle, "");
const [category, setCategory] = useLocalStorageState<Category>(STORAGE_KEYS.category, "");


// derived/ephemeral state
const [answer, setAnswer] = useState<string | null>(null);
const [chart, setChart] = useState<ChartSpec | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);


const canSubmit = useMemo(() => prompt.trim().length > 0 && !loading, [prompt, loading]);


const ask = useCallback(async () => {
if (!canSubmit) return;
setLoading(true);
setAnswer(null);
setChart(null);
setError(null);


try {
const payload = {
prompt,
wantsChart,
chartType,
category,
...(chartTitle.trim() ? { chartTitle: chartTitle.trim() } : {}),
} as const;


const res = await askAssistant(payload);
setAnswer(res.answer ?? "");
setChart((res.chart as ChartSpec) ?? null);
} catch (e: any) {
setError(e?.message ?? "Unknown error");
} finally {
setLoading(false);
}
}, [canSubmit, prompt, wantsChart, chartType, category, chartTitle]);


const clear = useCallback(() => {
setAnswer(null);
setChart(null);
setError(null);
setPrompt("");
}, [setPrompt]);


return {
// state
prompt, setPrompt,
wantsChart, setWantsChart,
chartType, setChartType,
chartTitle, setChartTitle,
category, setCategory,


answer, chart, loading, error,


// derived/handlers
canSubmit,
ask,
clear,
} as const;
}