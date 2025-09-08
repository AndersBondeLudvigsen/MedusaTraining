"use client";
import { Heading } from "@medusajs/ui";


export function RatesSection({ thisMinute, baseline }: { thisMinute: Record<string, number>; baseline: Record<string, number>; }) {
const entries = Object.entries(thisMinute || {});
return (
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
{entries.length === 0 && (
<tr><td className="p-2" colSpan={3}>No calls yet</td></tr>
)}
{entries.map(([tool, count]) => (
<tr key={tool} className="border-t">
<td className="p-2 whitespace-nowrap">{tool}</td>
<td className="p-2">{count}</td>
<td className="p-2">{(baseline?.[tool] ?? 0).toFixed?.(2) ?? 0}</td>
</tr>
))}
</tbody>
</table>
</div>
</section>
);
}