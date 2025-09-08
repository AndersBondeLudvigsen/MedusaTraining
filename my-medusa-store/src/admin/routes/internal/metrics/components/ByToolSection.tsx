"use client";
import { Heading } from "@medusajs/ui";
import type { ToolStats } from "../types";
import { formatMs } from "../lib/format";


export function ByToolSection({ tools }: { tools: [string, ToolStats][] }) {
return (
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
{tools.length === 0 && (<tr><td className="p-2" colSpan={4}>No data</td></tr>)}
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
);
}