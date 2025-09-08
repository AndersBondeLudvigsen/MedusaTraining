"use client";
import { Button } from "@medusajs/ui";


export function ControlsBar({
loading,
autoRefresh,
setAutoRefresh,
intervalMs,
setIntervalMs,
onRefresh,
}: {
loading: boolean;
autoRefresh: boolean;
setAutoRefresh: (v: boolean) => void;
intervalMs: number;
setIntervalMs: (v: number) => void;
onRefresh: () => void;
}) {
return (
<div className="flex flex-wrap items-center gap-2">
<Button size="small" variant="secondary" onClick={onRefresh} disabled={loading}>
{loading ? "Refreshing…" : "Refresh"}
</Button>
<label className="flex items-center gap-2">
<input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
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
<a className="text-ui-link hover:underline ml-auto" href="/internal/metrics?format=json" target="_blank" rel="noreferrer">
Open raw JSON
</a>
</div>
);
}