"use client";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { Beaker } from "@medusajs/icons";


import { useMetrics } from "./hooks/useMetrics";
import { ControlsBar } from "./components/ControlsBar";
import { TotalsSection } from "./components/TotalsSection";
import { RatesSection } from "./components/RatesSection";
import { ByToolSection } from "./components/ByToolSection";
import { AlertsSection } from "./components/AlertsSection";
import { AssistantSummarySection } from "./components/AssistantSummarySection";
import { AssistantTurnsSection } from "./components/AssistantTurnsSection";
import { RecentEventsSection } from "./components/RecentEventsSection";


const MetricsPage = () => {
const { summary, loading, error, autoRefresh, setAutoRefresh, intervalMs, setIntervalMs, tools, load } = useMetrics();


return (
<Container className="divide-y p-0">
<div className="flex items-center justify-between px-6 py-4">
<Heading level="h1">AI Metrics</Heading>
</div>


<div className="px-6 py-4 grid gap-4">
<Text size="small">Observability for the assistant: tool calls, rates, errors, alerts — plus assistant turn validations against grounded numbers.</Text>


<ControlsBar
loading={loading}
autoRefresh={autoRefresh}
setAutoRefresh={setAutoRefresh}
intervalMs={intervalMs}
setIntervalMs={(v) => setIntervalMs(Number(v) || 5000)}
onRefresh={load}
/>


{error && <div className="text-ui-fg-error">Error: {error}</div>}


<TotalsSection totalEvents={summary?.totals.totalEvents ?? 0} lastHour={summary?.totals.lastHour ?? 0} />
<RatesSection thisMinute={summary?.rates.thisMinute ?? {}} baseline={summary?.rates.baselineAvgPerMinute ?? {}} />
<ByToolSection tools={tools} />
<AlertsSection anomalies={summary?.anomalies ?? []} />
<AssistantSummarySection summary={summary?.assistant} />
<AssistantTurnsSection turns={summary?.assistant?.turns} />
<RecentEventsSection events={summary?.recentEvents ?? []} />
</div>
</Container>
);
};


export const config = defineRouteConfig({ label: "AI Metrics", icon: Beaker });
export default MetricsPage;