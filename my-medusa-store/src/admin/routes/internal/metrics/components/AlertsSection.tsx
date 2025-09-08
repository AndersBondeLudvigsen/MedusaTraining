"use client";
import { Heading, Text } from "@medusajs/ui";
import type { Anomaly } from "../types";
import { timeStr } from "../lib/format";


export function AlertsSection({ anomalies }: { anomalies: Anomaly[] }) {
return (
<section className="grid gap-2">
<Heading level="h2">Alerts</Heading>
<div className="border rounded-md p-2">
{(anomalies?.length ?? 0) === 0 && (<Text size="small">No anomalies</Text>)}
<ul className="grid gap-1">
{anomalies?.map((a) => (
<li key={a.id} className="text-sm">
<span className="text-ui-fg-subtle">[{timeStr(a.timestamp)}]</span>{" "}
<b>{a.type}</b>: {a.message}
{a.type === "negative-inventory" && (a.details as any)?.fields?.length ? (
<div className="mt-1 ml-4">
<details>
<summary className="cursor-pointer text-ui-fg-subtle">
{(a.details as any)?.scoped ? "Scoped detection (inventory keys only)" : "Detection details"}
</summary>
<ul className="list-disc ml-6 mt-1">
{(a.details as any).fields.map((f: any, i: number) => (
<li key={i}><code>{f.path}</code>: {String(f.value)}</li>
))}
</ul>
</details>
</div>
) : null}
</li>
))}
</ul>
</div>
</section>
);
}