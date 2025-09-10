import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text, Input, Label, Select, toast, Toaster } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { sdk } from "../../../lib/sdk"
import { Sun } from "@medusajs/icons"



const SeedProductsPage = () => {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState("")
  const [recentOrders, setRecentOrders] = useState<Array<{ id: string; display_id?: string }>>([])
  const [ordersLoading, setOrdersLoading] = useState(false)

  const runSeed = async (script: string, extra?: Record<string, any>) => {
    setLoading(true)
    setMessage(null)
    setError(null)
    try {
      const res = await sdk.client.fetch<{ message: string }>(
        "/admin/seed",
        {
          method: "POST",
          body: { script, ...extra },
        }
      )
      setMessage(res?.message || "Done")
      toast.success(res?.message || `Script '${script}' finished`)
    } catch (e: any) {
      setError(e?.message ?? "Failed")
      toast.error(e?.message ?? `Script '${script}' failed`)
    } finally {
      setLoading(false)
    }
  }

  const loadRecentOrders = async () => {
    setOrdersLoading(true)
    try {
      const res = await sdk.client.fetch<{ orders: Array<{ id: string; display_id?: string }> }>(
        "/admin/orders/recent?limit=25",
        { method: "GET" }
      )
      setRecentOrders(res?.orders || [])
      if ((res?.orders || []).length) {
        toast.success("Loaded recent orders")
      } else {
        toast.info("No recent orders found")
      }
    } catch (_) {
      // ignore
      toast.error("Failed to load recent orders")
    } finally {
      setOrdersLoading(false)
    }
  }

  useEffect(() => {
    loadRecentOrders()
  }, [])

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Seed Data</Heading>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        <Text>Run one of the seed scripts directly from the admin.</Text>
        <div className="flex flex-wrap gap-2">
          <Button size="small" disabled={loading} onClick={() => runSeed("seed-data")}>Seed products (light)</Button>
          <Button size="small" variant="secondary" disabled={loading} onClick={() => runSeed("seed-orders")}>Seed orders</Button>
          <Button size="small" variant="secondary" disabled={loading} onClick={() => runSeed("seed-customers")}>Seed customers</Button>
          <Button
            size="small"
            variant="secondary"
            disabled={loading}
            onClick={() => {
              if (confirm("This will delete ALL orders, draft orders, and carts. This cannot be undone. Continue?")) {
                runSeed("nuke-orders")
              }
            }}
          >
            Delete orders
          </Button>
        </div>
        <div className="mt-6 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <Heading level="h2">Create Return</Heading>
            <Button size="small" variant="secondary" disabled={ordersLoading} onClick={loadRecentOrders}>
              {ordersLoading ? "Refreshing…" : "Refresh orders"}
            </Button>
          </div>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Create and complete a return for a specific order.
          </Text>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="order-id">Order ID</Label>
              <Input
                id="order-id"
                placeholder="order_..."
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              />
              <Text size="small" className="text-ui-fg-subtle mt-1">Paste an order ID or pick from recent.</Text>
            </div>
            <div className="sm:col-span-1">
              <Label>Recent orders</Label>
              <Select
                size="base"
                value={orderId || undefined}
                onValueChange={(val) => setOrderId(val)}
              >
                <Select.Trigger aria-label="Recent orders">
                  <Select.Value placeholder="Select recent order" />
                </Select.Trigger>
                <Select.Content>
                  {recentOrders.length === 0 ? (
                    <Select.Item value="no-orders" disabled>
                      {ordersLoading ? "Loading…" : "No recent orders"}
                    </Select.Item>
                  ) : (
                    recentOrders.map((o) => (
                      <Select.Item key={o.id} value={o.id}>
                        {(o.display_id ? `#${o.display_id}` : o.id).toString()}
                      </Select.Item>
                    ))
                  )}
                </Select.Content>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Button
              size="small"
              disabled={loading || !orderId}
              onClick={() => {
                if (!orderId) return
                const confirmed = confirm(
                  `Create a return for order '${orderId}'? This will create, receive, and attempt refunds as needed.`
                )
                if (!confirmed) return
                runSeed("create-returns", { args: [`--order-id=${orderId}`] })
              }}
            >
              Create return
            </Button>
          </div>
        </div>
        {message && <Text className="text-green-600">{message}</Text>}
        {error && <Text className="text-ui-fg-error">{error}</Text>}
      </div>
      <Toaster position="bottom-right" />
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Seed data", icon: Sun })
export default SeedProductsPage
