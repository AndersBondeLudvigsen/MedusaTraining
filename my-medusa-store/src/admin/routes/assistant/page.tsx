import { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { ChartRenderer, ChartSpec } from "./ChartRenderer"

const AssistantPage = () => {
  const [prompt, setPrompt] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [chart, setChart] = useState<ChartSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Persist state so it survives navigation away/back
  const STORAGE_KEY_PROMPT = "assistant:prompt"
  const STORAGE_KEY_ANSWER = "assistant:answer"
  const STORAGE_KEY_CHART = "assistant:chart"
  useEffect(() => {
    try {
      const savedPrompt = localStorage.getItem(STORAGE_KEY_PROMPT)
      if (savedPrompt) setPrompt(savedPrompt)

      const savedAnswer = localStorage.getItem(STORAGE_KEY_ANSWER)
      if (savedAnswer) setAnswer(savedAnswer)

      const savedChart = localStorage.getItem(STORAGE_KEY_CHART)
      if (savedChart) {
        try {
          const parsed = JSON.parse(savedChart) as ChartSpec
          if (parsed && typeof parsed === "object") setChart(parsed)
        } catch {}
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      // Only store non-empty prompts to avoid cluttering storage
      if (prompt && prompt.trim().length > 0) {
        localStorage.setItem(STORAGE_KEY_PROMPT, prompt)
      } else {
        localStorage.removeItem(STORAGE_KEY_PROMPT)
      }
    } catch {}
  }, [prompt])

  useEffect(() => {
    try {
      if (answer && answer.trim().length > 0) {
        localStorage.setItem(STORAGE_KEY_ANSWER, answer)
      } else {
        localStorage.removeItem(STORAGE_KEY_ANSWER)
      }
    } catch {}
  }, [answer])

  useEffect(() => {
    try {
      if (chart) {
        localStorage.setItem(STORAGE_KEY_CHART, JSON.stringify(chart))
      } else {
        localStorage.removeItem(STORAGE_KEY_CHART)
      }
    } catch {}
  }, [chart])

  const canSubmit = useMemo(() => prompt.trim().length > 0 && !loading, [prompt, loading])

  const onAsk = useCallback(async () => {
    if (!canSubmit) return
    setLoading(true)
    setAnswer(null)
  setError(null)
  setChart(null)
    try {
      const res = await fetch("/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        credentials: "include",
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || `Request failed with ${res.status}`)
      }
      const ans: string = json?.answer ?? ""
      // Try to extract a ChartSpec JSON from fenced code blocks
      const chartRes = extractChartSpec(ans)
      if (chartRes?.spec) {
        setChart(chartRes.spec)
      }
      setAnswer(ans)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [prompt, canSubmit])

  const onClear = useCallback(() => {
    setPrompt("")
    setAnswer(null)
    setChart(null)
    setError(null)
    try {
      localStorage.removeItem(STORAGE_KEY_PROMPT)
      localStorage.removeItem(STORAGE_KEY_ANSWER)
      localStorage.removeItem(STORAGE_KEY_CHART)
    } catch {}
  }, [])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Assistant</Heading>
      </div>
      <div className="px-6 py-4 grid gap-3">
        <Text size="small">Ask the assistant for help with merchandising, pricing, and more.</Text>
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
            className={`rounded-md px-3 py-1.5 text-white ${canSubmit ? "bg-ui-bg-interactive" : "bg-ui-border-disabled cursor-not-allowed"}`}
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
        {error && (
          <div className="text-ui-fg-error">Error: {error}</div>
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
  )
}

export const config = defineRouteConfig({
  label: "AI Assistant",
})

export default AssistantPage

// Utilities
type MaybeChart = { spec?: ChartSpec | null }
function extractChartSpec(answer: string | null | undefined): MaybeChart {
  if (!answer) return {}
  // Try ```json ... ``` or ``` ... ``` blocks
  const fence = /```(?:json)?\n([\s\S]*?)\n```/i
  const m = answer.match(fence)
  if (!m) return {}
  try {
    const obj = JSON.parse(m[1])
    if (obj && obj.type === "chart" && Array.isArray(obj.data)) {
      return { spec: obj as ChartSpec }
    }
  } catch {}
  return {}
}
