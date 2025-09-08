"use client";
import { Heading, Text } from "@medusajs/ui";
import type { AssistantSummary } from "../types";


export function AssistantSummarySection({ summary }: { summary?: AssistantSummary }) {
if (!summary) {
return (
<section className="grid gap-1">
<Heading level="h2">Assistant — Validation Summary</Heading>
<Text size="small">No assistant data yet</Text>
</section>
);
}
return (
<section className="grid gap-1">
<Heading level="h2">Assistant — Validation Summary</Heading>
<div className="flex gap-6 text-sm">
<div>
<span className="text-ui-fg-subtle">Checks:</span>{" "}
<span className="font-medium">{summary.validation.total}</span>
</div>
<div>
<span className="text-ui-fg-subtle">OK:</span>{" "}
<span className="font-medium text-ui-fg-success">{summary.validation.ok}</span>
</div>
<div>
<span className="text-ui-fg-subtle">Fail:</span>{" "}
<span className="font-medium text-ui-fg-error">{summary.validation.fail}</span>
</div>
</div>
</section>
);
}