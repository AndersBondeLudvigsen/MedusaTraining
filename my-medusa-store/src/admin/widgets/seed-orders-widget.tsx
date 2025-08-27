import { Button, toast } from "@medusajs/ui"
import { Sparkles } from "@medusajs/icons"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useState } from "react"

// This is the React component for your widget.
const ToasterButtonWidget = () => {
  const [running, setRunning] = useState(false)

  const handleClick = async () => {
    if (running) return
    setRunning(true)
  const toastId = toast.loading("Running seed scripts...")
    try {
      const res = await fetch("/admin/seeds/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Request failed with ${res.status}`)
      }
      const data = await res.json()

      const ok = Number(data?.okCount ?? 0)
      const err = Number(data?.errCount ?? 0)
      toast.success("Seeds finished", {
        description: `${ok} succeeded, ${err} failed`,
      })

      if (Array.isArray(data?.results)) {
        // Log details to console for debugging
        // eslint-disable-next-line no-console
        console.table(
          data.results.map((r: any) => ({
            script: r.name,
            status: r.status,
            error: r.error || "",
          }))
        )
      }
    } catch (e: any) {
      toast.error("Seed run failed", {
        description: e?.message || String(e),
      })
    } finally {
      // Dismiss loading toast by id
      toast.dismiss(toastId)
      setRunning(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="small"
      onClick={handleClick}
      className="w-full"
      disabled={running}
    >
      <Sparkles />
      {running ? "Running seeds..." : "Run seed scripts"}
    </Button>
  )
}

// This config object tells Medusa where to place your widget.
// "admin.list_setting.before" injects it into the main sidebar
// right before the "Settings" link.
export const config = defineWidgetConfig({
  // Use a valid injection zone; choose a page where you want the button.
  // For example, place it above the orders list:
  zone: "order.list.before",
})

export default ToasterButtonWidget;