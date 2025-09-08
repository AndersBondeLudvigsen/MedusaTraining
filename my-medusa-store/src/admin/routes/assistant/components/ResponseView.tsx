import { ChartRenderer } from "../ChartRenderer";
import type { ChartSpec } from "../ChartRenderer";


export function ResponseView({ wantsChart, chart, answer }: {
wantsChart: boolean;
chart: ChartSpec | null;
answer: string | null;
}) {
return (
<>
{wantsChart && chart && (
<div className="rounded-md border p-3 bg-ui-bg-base">
<ChartRenderer spec={chart} height={300} />
</div>
)}


{answer && (
<div className="whitespace-pre-wrap border-ui-border-base bg-ui-bg-subtle rounded-md border p-3">
{answer}
</div>
)}
</>
);
}