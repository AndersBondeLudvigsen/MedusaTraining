"use client";
import { useAssistant } from "./hooks/useAssistant";
import { CategorySelect } from "./components/CategorySelect";
import { ChartControls } from "./components/ChartControls";
import { PromptInput } from "./components/PromptInput";
import { ResponseView } from "./components/ResponseView";
import { AssistantLoading } from "./components/Loading";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { AiAssistent } from "@medusajs/icons";


const AssistantPage = () => {
const {
prompt, setPrompt,
wantsChart, setWantsChart,
chartType, setChartType,
chartTitle, setChartTitle,
category, setCategory,
answer, chart, loading, error,
canSubmit, ask, clear,
} = useAssistant();


return (
<Container className="divide-y p-0">
<div className="flex items-center justify-between px-6 py-4">
<Heading level="h1">Assistant</Heading>
</div>


<div className="px-6 py-4 grid gap-3">
<Text size="small">Ask the assistant for help with merchandising, pricing, and more.</Text>


<CategorySelect value={category} onChange={setCategory} />


{category && (
<div className="text-xs text-ui-fg-muted bg-ui-bg-subtle px-2 py-1 rounded border">
<strong>Context:</strong> {category.charAt(0).toUpperCase() + category.slice(1)} focus mode
</div>
)}


<PromptInput value={prompt} onChange={setPrompt} category={category} onSubmit={ask} />


<ChartControls
wantsChart={wantsChart}
setWantsChart={(v) => { setWantsChart(v); if (!v) {/* hide chart if toggled off */} }}
chartType={chartType}
setChartType={setChartType}
chartTitle={chartTitle}
setChartTitle={setChartTitle}
/>


<div className="flex gap-2">
<button
onClick={ask}
disabled={!canSubmit}
className={`rounded-md px-3 py-1.5 text-white ${canSubmit ? "bg-ui-bg-interactive" : "bg-ui-border-disabled cursor-not-allowed"}`}
>
{loading ? "Asking…" : "Ask"}
</button>
<button onClick={clear} className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base" disabled={loading}>Clear</button>
</div>


{error && <div className="text-ui-fg-error">Error: {error}</div>}
{loading && (
<div className="rounded-md border p-3 bg-ui-bg-base"><AssistantLoading /></div>
)}


<ResponseView wantsChart={wantsChart} chart={chart} answer={answer} />
</div>
</Container>
);
};


export const config = defineRouteConfig({ label: "Promotions Assistant", icon: AiAssistent });
export default AssistantPage;