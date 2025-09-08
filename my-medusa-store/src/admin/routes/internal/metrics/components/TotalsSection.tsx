"use client";
import { Heading } from "@medusajs/ui";


export function TotalsSection({ totalEvents, lastHour }: { totalEvents: number; lastHour: number }) {
return (
<section className="grid gap-1">
<Heading level="h2">Totals (last hour)</Heading>
<div className="flex gap-6 text-sm">
<div>
<span className="text-ui-fg-subtle">Total events:</span>{" "}
<span className="font-medium">{totalEvents}</span>
</div>
<div>
<span className="text-ui-fg-subtle">Events in last hour:</span>{" "}
<span className="font-medium">{lastHour}</span>
</div>
</div>
</section>
);
}