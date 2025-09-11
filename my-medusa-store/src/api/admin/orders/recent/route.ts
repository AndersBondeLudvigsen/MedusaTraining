import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    // Try to list most recent orders. Not all fields are guaranteed across setups.
    const take = Math.max(1, Math.min(50, Number(req.query?.limit ?? 25)))
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "created_at",
        "email",
        "payment_status",
        "fulfillment_status",
      ],
      // filters: {}, // keep minimal for compatibility
    }).catch(async () => {
      // Fallback without ordering/take if unsupported
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "display_id"],
      })
      return { data }
    })

    const sorted = (data || []).sort((a: any, b: any) => {
      const da = a?.created_at ? new Date(a.created_at).getTime() : 0
      const db = b?.created_at ? new Date(b.created_at).getTime() : 0
      return db - da
    })

    const orders = sorted.slice(0, take).map((o: any) => ({
      id: o.id,
      display_id: o.display_id,
      created_at: o.created_at,
      email: o.email,
      payment_status: o.payment_status,
      fulfillment_status: o.fulfillment_status,
    }))

    return res.status(200).json({ orders })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? String(e) })
  }
}
