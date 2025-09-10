import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

function parseBody<T = any>(req: AuthenticatedMedusaRequest): T {
  try {
    return (req.body ?? {}) as T
  } catch {
    return {} as T
  }
}

// Load a seeder dynamically using CommonJS resolution:
function loadSeeder(script: string): any {
  try {
    // TS (dev)
    return require(`../../../scripts/${script}.ts`)
  } catch (_) {}
  // JS (build)
  return require(`../../../scripts/${script}.js`)
}

/**
 * POST /admin/seed
 * Body: { script?: "seed" | "seed-data" | "seed-orders" | "seed-customers" | "seed-customer-groups" }
 * Runs a seeding script using the current Medusa container.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { script = "seed-data" } = parseBody<{ script?: string }>(req)

  const allowed = new Set([
    "seed",
    "seed-data",
    "seed-orders",
    "seed-customers",
    "seed-customer-groups",
    "nuke-orders",
  ])

  if (!allowed.has(script)) {
    return res.status(400).json({ message: `Unknown script: ${script}` })
  }

  try {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const mod = loadSeeder(script)
    const run = (mod?.default || mod?.run || mod) as
      | ((args: { container: any }) => Promise<any>)
      | undefined

    if (typeof run !== "function") {
      return res.status(500).json({ message: `Script '${script}' export not callable` })
    }

    logger.info(`Running seed script: ${script}`)

    // Temporarily set confirmation env for destructive script
    const prevNuke = process.env.NUKE_ORDERS
    if (script === "nuke-orders") {
      process.env.NUKE_ORDERS = "1"
    }

    let result: any
    try {
      result = await run({ container: req.scope })
    } finally {
      if (script === "nuke-orders") {
        if (prevNuke === undefined) {
          delete process.env.NUKE_ORDERS
        } else {
          process.env.NUKE_ORDERS = prevNuke
        }
      }
    }

    return res.status(200).json({ message: `Seed '${script}' finished`, result })
  } catch (e: any) {
    const message = e?.message ?? String(e)
    return res.status(500).json({ message })
  }
}
