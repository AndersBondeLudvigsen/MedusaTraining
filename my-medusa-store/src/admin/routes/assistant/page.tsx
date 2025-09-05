import { useCallback, useEffect, useMemo, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";
import { ChartRenderer, ChartSpec } from "./ChartRenderer";
import { AiAssistent } from "@medusajs/icons";

const AssistantPage = () => {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Category selection
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  // NEW: chart controls
  const [wantsChart, setWantsChart] = useState<boolean>(false);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [chartTitle, setChartTitle] = useState<string>("");

  // Persist state so it survives navigation away/back
  const STORAGE_KEY_PROMPT = "assistant:prompt";
  const STORAGE_KEY_ANSWER = "assistant:answer";
  const STORAGE_KEY_CHART = "assistant:chart";
  const STORAGE_KEY_WANTS_CHART = "assistant:wantsChart";
  const STORAGE_KEY_CHART_TYPE = "assistant:chartType";
  const STORAGE_KEY_CHART_TITLE = "assistant:chartTitle";
  const STORAGE_KEY_CATEGORY = "assistant:category";

  useEffect(() => {
    try {
      const savedPrompt = localStorage.getItem(STORAGE_KEY_PROMPT);
      if (savedPrompt) setPrompt(savedPrompt);

      const savedAnswer = localStorage.getItem(STORAGE_KEY_ANSWER);
      if (savedAnswer) setAnswer(savedAnswer);

      const savedChart = localStorage.getItem(STORAGE_KEY_CHART);
      if (savedChart) {
        try {
          const parsed = JSON.parse(savedChart) as ChartSpec;
          if (parsed && typeof parsed === "object") setChart(parsed);
        } catch {}
      }

      const savedWants = localStorage.getItem(STORAGE_KEY_WANTS_CHART);
      if (savedWants != null) setWantsChart(savedWants === "true");

      const savedType = localStorage.getItem(STORAGE_KEY_CHART_TYPE);
      if (savedType === "bar" || savedType === "line") setChartType(savedType);

      const savedTitle = localStorage.getItem(STORAGE_KEY_CHART_TITLE);
      if (savedTitle != null) setChartTitle(savedTitle);

      const savedCategory = localStorage.getItem(STORAGE_KEY_CATEGORY);
      if (savedCategory) setSelectedCategory(savedCategory);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (prompt && prompt.trim().length > 0) {
        localStorage.setItem(STORAGE_KEY_PROMPT, prompt);
      } else {
        localStorage.removeItem(STORAGE_KEY_PROMPT);
      }
    } catch {}
  }, [prompt]);

  useEffect(() => {
    try {
      if (answer && answer.trim().length > 0) {
        localStorage.setItem(STORAGE_KEY_ANSWER, answer);
      } else {
        localStorage.removeItem(STORAGE_KEY_ANSWER);
      }
    } catch {}
  }, [answer]);

  useEffect(() => {
    try {
      if (chart) {
        localStorage.setItem(STORAGE_KEY_CHART, JSON.stringify(chart));
      } else {
        localStorage.removeItem(STORAGE_KEY_CHART);
      }
    } catch {}
  }, [chart]);

  // NEW: persist chart preferences
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_WANTS_CHART, String(wantsChart));
    } catch {}
  }, [wantsChart]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_TYPE, chartType);
    } catch {}
  }, [chartType]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CHART_TITLE, chartTitle);
    } catch {}
  }, [chartTitle]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CATEGORY, selectedCategory);
    } catch {}
  }, [selectedCategory]);

  // Category-specific prompts and placeholders
  const getCategoryPlaceholder = (category: string) => {
    switch (category) {
      case "customers":
        return 'Ask about customers (e.g. "How many new customers did we get this month?" or "Show me customer demographics")';
      case "orders":
        return 'Ask about orders (e.g. "How many orders do I have in 2025, grouped by month?" or "What is my average order value?")';
      case "products":
        return 'Ask about products (e.g. "Which products are my best sellers?" or "Show me products with low inventory")';
      case "promotions":
        return 'Ask about promotions (e.g. "How effective were my recent promotions?" or "Show me discount usage statistics")';
      default:
        return 'Ask the assistant (e.g. "How many orders do I have in 2025, grouped by month?")';
    }
  };

  const canSubmit = useMemo(
    () => prompt.trim().length > 0 && !loading,
    [prompt, loading]
  );

  const onAsk = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setAnswer(null);
    setError(null);
    setChart(null);
    try {
      const body: any = {
        prompt: prompt,
        wantsChart,
        chartType,
        category: selectedCategory,
      };
      if (chartTitle && chartTitle.trim().length > 0) {
        body.chartTitle = chartTitle.trim();
      }

      const res = await fetch("/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed with ${res.status}`);
      }

      // NEW: route.ts now returns { answer, chart, data, history }
      const ans: string = json?.answer ?? "";
      const returnedChart: ChartSpec | null | undefined = json?.chart ?? null;

      setAnswer(ans);
      setChart(returnedChart ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [prompt, canSubmit, wantsChart, chartType, chartTitle, selectedCategory]);

  const onClear = useCallback(() => {
    setPrompt("");
    setAnswer(null);
    setChart(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY_PROMPT);
      localStorage.removeItem(STORAGE_KEY_ANSWER);
      localStorage.removeItem(STORAGE_KEY_CHART);
      // keep user’s chart preferences; comment out below if you prefer resetting
      // localStorage.removeItem(STORAGE_KEY_WANTS_CHART);
      // localStorage.removeItem(STORAGE_KEY_CHART_TYPE);
      // localStorage.removeItem(STORAGE_KEY_CHART_TITLE);
    } catch {}
  }, []);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Assistant</Heading>
      </div>

      <div className="px-6 py-4 grid gap-3">
        <Text size="small">
          Ask the assistant for help with merchandising, pricing, and more.
        </Text>

        {/* Category Selection */}
        <div className="flex items-center gap-2">
          <label htmlFor="category-select" className="text-ui-fg-subtle font-medium">
            Category:
          </label>
          <select
            id="category-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-md border border-ui-border-base bg-ui-bg-base text-ui-fg-base px-3 py-2 min-w-[150px]"
          >
            <option value="">Select a category</option>
            <option value="customers">Customers</option>
            <option value="orders">Orders</option>
            <option value="products">Products</option>
            <option value="promotions">Promotions</option>
          </select>
        </div>

        {/* Category Context Indicator */}
        {selectedCategory && (
          <div className="text-xs text-ui-fg-muted bg-ui-bg-subtle px-2 py-1 rounded border">
            <strong>Context:</strong> {selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} focus mode
          </div>
        )}

        {/* Prompt input */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAsk();
            }
          }}
          placeholder={getCategoryPlaceholder(selectedCategory)}
          rows={4}
          className="border-ui-border-base bg-ui-bg-base text-ui-fg-base rounded-md border p-2"
        />

        {/* NEW: Chart controls */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wantsChart}
              onChange={(e) => {
                const checked = e.target.checked;
                setWantsChart(checked);
                if (!checked) setChart(null); // hide old chart if toggled off
              }}
            />
            <span>Include chart</span>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-ui-fg-subtle">Type</span>
            <select
              disabled={!wantsChart}
              value={chartType}
              onChange={(e) => setChartType((e.target.value as "bar" | "line") ?? "bar")}
              className="rounded-md border p-1 bg-ui-bg-base"
            >
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          </label>

          <label className="flex items-center gap-2 flex-1 min-w-[220px]">
            <span className="text-ui-fg-subtle">Title</span>
            <input
              type="text"
              disabled={!wantsChart}
              value={chartTitle}
              onChange={(e) => setChartTitle(e.target.value)}
              placeholder="Optional custom chart title"
              className="flex-1 rounded-md border p-1 bg-ui-bg-base"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onAsk}
            disabled={!canSubmit}
            className={`rounded-md px-3 py-1.5 text-white ${
              canSubmit
                ? "bg-ui-bg-interactive"
                : "bg-ui-border-disabled cursor-not-allowed"
            }`}
          >
            {loading ? "Asking…" : "Ask"}
          </button>
          <button
            onClick={onClear}
            className="rounded-md px-3 py-1.5 border bg-ui-bg-base text-ui-fg-base"
            disabled={loading}
          >
            Clear
          </button>
        </div>

        {error && <div className="text-ui-fg-error">Error: {error}</div>}

        {loading && (
          <div className="rounded-md border p-3 bg-ui-bg-base">
            <AssistantLoading />
          </div>
        )}

        {/* NEW: chart comes from server json.chart, not parsed from answer */}
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
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Promotions Assistant",
  icon: AiAssistent,
});

export default AssistantPage;

// Sleek loading indicator: typing dots, progress stripe, chart ghost, and text skeletons
function AssistantLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <PulseAvatar />
        <div>
          <div className="text-ui-fg-base font-medium">
            Assistant is thinking…
          </div>
          <TypingDots />
        </div>
      </div>
      <ProgressStripe />
      <ChartGhost height={300} />
      <AnswerSkeleton lines={5} />
    </div>
  );
}

function TypingDots() {
  return (
    <div
      className="flex items-center gap-1 text-ui-fg-subtle text-xs"
      aria-live="polite"
    >
      <span>Preparing response</span>
      <span className="relative inline-block" style={{ width: 24, height: 10 }}>
        <style>
          {`@keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: .4 } 40% { transform: translateY(-3px); opacity: 1 } }`}
        </style>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: i * 8,
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: "currentColor",
              animation: `bounce 1.4s ${i * 0.15}s infinite ease-in-out`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function ProgressStripe() {
  return (
    <div className="w-full h-1.5 overflow-hidden rounded bg-ui-bg-subtle border">
      <style>
        {`@keyframes slide { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }`}
      </style>
      <div
        style={{
          width: "40%",
          height: "100%",
          background:
            "linear-gradient(90deg, rgba(99,102,241,0.2), rgba(99,102,241,0.6))",
          animation: "slide 1.2s infinite",
        }}
      />
    </div>
  );
}

function ChartGhost({ height = 280 }: { height?: number }) {
  return (
    <div
      className="rounded-md border"
      style={{
        height,
        background:
          "repeating-linear-gradient(0deg, var(--bg,#0b0b0b00), var(--bg,#0b0b0b00) 18px, rgba(100,116,139,0.08) 18px, rgba(100,116,139,0.08) 19px)",
      }}
    >
      <style>{`:root { --bg: transparent; }`}</style>
    </div>
  );
}

function AnswerSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="grid gap-2">
      <style>
        {`@keyframes shimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }`}
      </style>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-ui-bg-subtle overflow-hidden">
          <div
            style={{
              width: "50%",
              height: "100%",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
              animation: "shimmer 1.2s infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PulseAvatar() {
  return (
    <div
      style={{ position: "relative", width: 28, height: 28 }}
      aria-hidden="true"
    >
      <style>
        {`@keyframes pulse { 0% { opacity: .6; transform: scale(1);} 50% { opacity: 1; transform: scale(1.06);} 100% { opacity: .6; transform: scale(1);} }`}
      </style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 9999,
          background: "radial-gradient(circle at 30% 30%, #6366f1, #4338ca)",
          boxShadow: "0 0 0 2px rgba(99,102,241,0.3)",
          animation: "pulse 1.8s ease-in-out infinite",
        }}
      />
    </div>
  );
}
