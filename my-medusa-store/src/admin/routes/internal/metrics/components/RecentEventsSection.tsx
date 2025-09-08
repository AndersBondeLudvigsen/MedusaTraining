"use client";
import { Heading } from "@medusajs/ui";
import type { ToolEvent } from "../types";
import { timeStr } from "../lib/format";


export function RecentEventsSection({ events }: { events: ToolEvent[] }) {
return (
<section className="grid gap-2">
<Heading level="h2">Recent Events</Heading>
<div className="overflow-auto border rounded-md">
<table className="w-full text-sm">
<thead>
<tr className="bg-ui-bg-subtle text-left">
<th className="p-2">Time</th>
<th className="p-2">Tool</th>
<th className="p-2">OK</th>
<th className="p-2">ms</th>
<th className="p-2">Args</th>
<th className="p-2">Result</th>
</tr>
</thead>
<tbody>
{(events?.length ?? 0) === 0 && (
<tr><td className="p-2" colSpan={6}>No events</td></tr>
)}
{events?.map((e) => (
<tr key={e.id} className="border-t align-top">
<td className="p-2 whitespace-nowrap">{timeStr(e.timestamp)}</td>
<td className="p-2 whitespace-nowrap">{e.tool}</td>
<td className="p-2">{e.success ? "✅" : "❌"}</td>
<td className="p-2">{e.durationMs ?? ""}</td>
<td className="p-2"><pre className="max-h-40 overflow-auto">{JSON.stringify(e.args, null, 2)}</pre></td>
<td className="p-2"><pre className="max-h-40 overflow-auto">{JSON.stringify(e.result, null, 2)}</pre></td>
</tr>
))}
</tbody>
</table>
</div>
</section>
);
}