import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createCustomerGroupsWorkflow,
  linkCustomersToCustomerGroupWorkflow,
} from "@medusajs/core-flows"

export default async function seedCustomerGroups({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1) Ensure 3 groups exist: "Young Adults", "Adults", "Women"
  const groupsToCreate = [
    { name: "Young Adults" },
    { name: "Adults" },
    { name: "Women" },
  ]

  // Fetch existing groups first
  const { data: existingGroups } = (await query.graph({
    entity: "customer_group",
    fields: ["id", "name"],
  })) as { data: Array<{ id: string; name: string }> }

  const existingNames = new Set(existingGroups.map((g) => g.name))
  const missing = groupsToCreate.filter((g) => !existingNames.has(g.name))

  if (missing.length) {
    await createCustomerGroupsWorkflow(container).run({
      input: { customersData: missing },
    })
    logger.info(`Created groups: ${missing.map((g) => g.name).join(", ")}`)
  } else {
    logger.info("All target groups already exist; skipping creation")
  }

  // Re-fetch to get the final set (ids + names)
  const { data: groups } = (await query.graph({
    entity: "customer_group",
    fields: ["id", "name"],
  })) as { data: Array<{ id: string; name: string }> }
  logger.info(
    `Ensured groups: ${groups
      .filter((g) => groupsToCreate.find((x) => x.name === g.name))
      .map((g) => `${g.name}(${g.id})`)
      .join(", ")}`
  )

  // 2) Fetch customers with metadata.age and metadata.gender
  const { data: customers } = (await query.graph({
    entity: "customer",
    fields: ["id", "email", "metadata"],
  })) as { data: Array<{ id: string; email: string; metadata?: any }> }

  // Partition customer IDs by rule
  const youngAdultIds: string[] = [] // age 18-25
  const adultIds: string[] = [] // age 26-70
  const womenIds: string[] = [] // gender === "female"

  for (const c of customers) {
    const age: number | undefined = c?.metadata?.age
    const gender: string | undefined = c?.metadata?.gender

    if (typeof age === "number") {
      if (age >= 18 && age <= 25) youngAdultIds.push(c.id)
      else if (age >= 26) adultIds.push(c.id)
    }
    if (gender?.toLowerCase() === "female") womenIds.push(c.id)
  }

  // Helper to find group id by name
  const groupIdByName = (name: string) => groups.find((g) => g.name === name)?.id

  // 3) Link customers to groups
  const ops: Array<Promise<any>> = []
  const yg = groupIdByName("Young Adults")
  const ad = groupIdByName("Adults")
  const wo = groupIdByName("Women")

  if (yg && youngAdultIds.length) {
    ops.push(
      linkCustomersToCustomerGroupWorkflow(container).run({
        input: { id: yg, add: youngAdultIds },
      })
    )
  }
  if (ad && adultIds.length) {
    ops.push(
      linkCustomersToCustomerGroupWorkflow(container).run({
        input: { id: ad, add: adultIds },
      })
    )
  }
  if (wo && womenIds.length) {
    ops.push(
      linkCustomersToCustomerGroupWorkflow(container).run({
        input: { id: wo, add: womenIds },
      })
    )
  }

  await Promise.all(ops)

  logger.info(
    `Linked: Young Adults(${youngAdultIds.length}), Adults(${adultIds.length}), Women(${womenIds.length})`
  )
}
