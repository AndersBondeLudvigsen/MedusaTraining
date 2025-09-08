"use client";
import { Heading, Badge, StatusBadge } from "@medusajs/ui";
import type { AssistantTurn } from "../types";
import { jsonPreview, numberOrDash, timeStr } from "../lib/format";


export function AssistantTurnsSection({ turns }: { turns: AssistantTurn[] | undefined }) {
return (
<section className="grid gap-2">
<Heading level="h2">Assistant — Recent Turns</Heading>
{!turns?.length ? (
<p className="text-sm text-ui-fg-subtle">No turns yet</p>
) : (
<div className="overflow-auto border rounded-md">
<table className="w-full text-sm">
<thead>
<tr className="bg-ui-bg-subtle text-left align-bottom">
<th className="p-2">Time</th>
<th className="p-2">Tools Used</th>
<th className="p-2">Grounded Numbers</th>
<th className="p-2">Extracted Numbers</th>
<th className="p-2">Validations</th>
</tr>
</thead>
<tbody>
{turns.map((t) => (
<tr key={t.id} className="border-t align-top">
<td className="p-2 whitespace-nowrap">{timeStr(t.timestamp)}</td>
<td className="p-2">
{t.toolsUsed?.length ? (
<div className="flex flex-wrap gap-1">
{t.toolsUsed.map((name) => (
<Badge key={name} size="small" >{name}</Badge>
))}
</div>
) : (
<span className="text-ui-fg-subtle">—</span>
)}
</td>
<td className="p-2">
{t.groundedNumbers ? (
<pre className="max-h-40 overflow-auto">{jsonPreview(t.groundedNumbers)}</pre>
) : (
<span className="text-ui-fg-subtle">—</span>
)}
</td>
<td className="p-2">
{t.extractedNumbers ? (
<pre className="max-h-40 overflow-auto">{jsonPreview(t.extractedNumbers)}</pre>
) : (
<span className="text-ui-fg-subtle">—</span>
)}
</td>
<td className="p-2">
{!t.validations?.length ? (
<span className="text-ui-fg-subtle">—</span>
) : (
<div className="overflow-auto">
<table className="min-w-[420px] text-xs border rounded-md">
<thead>
<tr className="bg-ui-bg-subtle text-left">
<th className="p-1">Label</th>
<th className="p-1">AI</th>
<th className="p-1">Tool</th>
<th className="p-1">Diff</th>
<th className="p-1">Status</th>
</tr>
</thead>
<tbody>
{t.validations.map((v, i) => (
<tr key={i} className="border-t">
<td className="p-1">{v.label}</td>
<td className="p-1">{numberOrDash(v.ai)}</td>
<td className="p-1">{numberOrDash(v.tool)}</td>
<td className="p-1">{typeof v?.delta?.diff === "number" ? v.delta.diff : "—"}</td>
<td className="p-1">
{v.ok ? (
<StatusBadge color="green">OK</StatusBadge>
) : (
<StatusBadge color="red">FAIL</StatusBadge>
)}
</td>
</tr>
))}
</tbody>
</table>
</div>
)}
</td>
</tr>
))}
</tbody>
</table>
</div>
)}
</section>
);
}