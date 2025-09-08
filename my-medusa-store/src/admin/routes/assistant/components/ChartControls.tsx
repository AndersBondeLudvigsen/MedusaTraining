export function ChartControls({
wantsChart,
setWantsChart,
chartType,
setChartType,
chartTitle,
setChartTitle,
}: {
wantsChart: boolean; setWantsChart: (v: boolean) => void;
chartType: "bar" | "line"; setChartType: (v: "bar" | "line") => void;
chartTitle: string; setChartTitle: (v: string) => void;
}) {
return (
<div className="flex flex-wrap items-center gap-3">
<label className="flex items-center gap-2">
<input type="checkbox" checked={wantsChart} onChange={(e) => setWantsChart(e.target.checked)} />
<span>Include chart</span>
</label>


<label className="flex items-center gap-2">
<span className="text-ui-fg-subtle">Type</span>
<select
disabled={!wantsChart}
value={chartType}
onChange={(e) => (setChartType((e.target.value as "bar" | "line") ?? "bar"))}
className="rounded-md border p-1 bg-ui-bg-base"
>
<option value="bar">Bar</option>
<option value="line">Line</option>
</select>
</label>


<label className="flex items-center gap-2 flex-1 min-w-[220px]">
<span className="text-ui-fg-subtle">Title</span>
<input
type="text"
disabled={!wantsChart}
value={chartTitle}
onChange={(e) => setChartTitle(e.target.value)}
placeholder="Optional custom chart title"
className="flex-1 rounded-md border p-1 bg-ui-bg-base"
/>
</label>
</div>
);
}