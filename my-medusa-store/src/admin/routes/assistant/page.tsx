import { useCallback, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"

const AssistantPage = () => {
  const [prompt, setPrompt] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canSubmit = useMemo(() => prompt.trim().length > 0 && !loading, [prompt, loading])

  const onAsk = useCallback(async () => {
    if (!canSubmit) return
    setLoading(true)
    setAnswer(null)
    setError(null)
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
      setAnswer(json?.answer ?? "")
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [prompt, canSubmit])

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
        </div>
        {error && (
          <div className="text-ui-fg-error">Error: {error}</div>
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
  label: "Promotions Assistant",
})

export default AssistantPage
