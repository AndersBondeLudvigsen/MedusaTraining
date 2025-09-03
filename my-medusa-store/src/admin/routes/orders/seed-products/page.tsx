import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useState } from "react"
import { sdk } from "../../../lib/sdk"
import { Sun } from "@medusajs/icons"



const SeedProductsPage = () => {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runSeed = async (script: string) => {
    setLoading(true)
    setMessage(null)
    setError(null)
    try {
      const res = await sdk.client.fetch<{ message: string }>(
        "/admin/seed",
        {
          method: "POST",
          body: { script },
        }
      )
      setMessage(res?.message || "Done")
    } catch (e: any) {
      setError(e?.message ?? "Failed")
    } finally {
      setLoading(false)
    }
  }

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
        </div>
        {message && <Text className="text-green-600">{message}</Text>}
        {error && <Text className="text-ui-fg-error">{error}</Text>}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Seed data", icon: Sun })
export default SeedProductsPage
