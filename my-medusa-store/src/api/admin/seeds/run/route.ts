import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

type RunResult = {
  name: string
  path: string
  status: "ok" | "skipped" | "error"
  error?: string
}

async function findScriptsDir(): Promise<string> {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, "dist", "scripts"),
    path.join(cwd, "src", "scripts"),
  ]
  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) return dir
    } catch {}
  }
  // Fallback to src/scripts even if it doesn't exist to yield a clearer error later
  return path.join(cwd, "src", "scripts")
}

async function listSeedFiles(scriptsDir: string): Promise<string[]> {
  const entries = await fs.readdir(scriptsDir, { withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) =>
      /^seed.*\.(m?js|cjs|ts)$/.test(name) && !name.endsWith(".d.ts")
    )
    // Sort to provide deterministic order
    .sort((a, b) => a.localeCompare(b))
  return files.map((f) => path.join(scriptsDir, f))
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const results: RunResult[] = []
  const scriptsDir = await findScriptsDir()
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  let files: string[] = []
  try {
    files = await listSeedFiles(scriptsDir)
  } catch (e: any) {
    res.status(500).json({ ok: false, message: `Failed to list scripts in ${scriptsDir}: ${e?.message || e}` })
    return
  }

  if (!files.length) {
    res.status(404).json({ ok: false, message: `No seed scripts found in ${scriptsDir}` })
    return
  }

  for (const filePath of files) {
    const name = path.basename(filePath)
    try {
      // Prefer importing built JS if available; dynamic import handles both .ts during dev and .js in build
      const mod = await import(pathToFileURL(filePath).href)
      const fn = mod?.default
      if (typeof fn !== "function") {
        results.push({ name, path: filePath, status: "skipped", error: "No default export function" })
        continue
      }

      logger.info(`[seeds:run] Executing ${name}...`)
      await fn({ container: req.scope })
      results.push({ name, path: filePath, status: "ok" })
      logger.info(`[seeds:run] Completed ${name}`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      results.push({ name, path: filePath, status: "error", error: msg })
      logger.error(`[seeds:run] Failed ${name}: ${msg}`)
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length
  const errCount = results.filter((r) => r.status === "error").length
  res.json({ ok: true, scriptsDir, okCount, errCount, results })
}
