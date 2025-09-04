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

  // Persist state so it survives navigation away/back
  const STORAGE_KEY_PROMPT = "assistant:prompt";
  const STORAGE_KEY_ANSWER = "assistant:answer";
  const STORAGE_KEY_CHART = "assistant:chart";
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
    } catch {}
  }, []);

  useEffect(() => {
    try {
      // Only store non-empty prompts to avoid cluttering storage
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
      const res = await fetch("/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed with ${res.status}`);
      }
      const ans: string = json?.answer ?? "";
      // Try to extract a ChartSpec JSON from fenced code blocks
      const chartRes = extractChartSpec(ans);
      if (chartRes?.spec) {
        setChart(chartRes.spec);
      }
      setAnswer(ans);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [prompt, canSubmit]);

  const onClear = useCallback(() => {
    setPrompt("");
    setAnswer(null);
    setChart(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY_PROMPT);
      localStorage.removeItem(STORAGE_KEY_ANSWER);
      localStorage.removeItem(STORAGE_KEY_CHART);
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
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAsk();
            }
          }}
          placeholder='Ask the assistant (e.g. "Suggest a promotion description")'
          rows={4}
          className="border-ui-border-base bg-ui-bg-base text-ui-fg-base rounded-md border p-2"
        />
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
        {chart && (
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

// Utilities
type MaybeChart = { spec?: ChartSpec | null };
function extractChartSpec(answer: string | null | undefined): MaybeChart {
  if (!answer) return {};
  // Try ```json ... ``` or ``` ... ``` blocks
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i;
  const m = answer.match(fence);
  if (!m) return {};
  try {
    const obj = JSON.parse(m[1]);
    if (obj && obj.type === "chart" && Array.isArray(obj.data)) {
      return { spec: obj as ChartSpec };
    }
  } catch {}
  return {};
}

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
