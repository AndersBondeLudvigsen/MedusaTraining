import { ExecArgs } from "@medusajs/framework/types"
import { createCustomersWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function seedCustomers({ container }: ExecArgs) {
  const { faker } = await import("@faker-js/faker")

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Generate 5 fake customers
  const customersData = Array.from({ length: 5 }).map(() => {
    const gender = faker.person.sex() // "male" | "female"
    const age = faker.number.int({ min: 18, max: 70 })

    return {
      first_name: faker.person.firstName(),
      last_name: faker.person.lastName(),
      email: faker.internet.email().toLowerCase(),
      metadata: {
        age,
        gender,
      },
    }
  })

  // Optional: filter out emails that already exist to avoid duplicates
  const emails = customersData.map((c) => c.email)
  const existing = (await query.graph({
    entity: "customer",
    fields: ["id", "email"],
    filters: { email: emails },
  })) as { data: Array<{ id: string; email: string }> }

  const existingEmails = new Set((existing.data || []).map((c) => c.email))
  const toCreate = customersData.filter((c) => !existingEmails.has(c.email))

  if (!toCreate.length) {
    logger.info("No new customers to create (all 5 emails already exist).")
    return
  }

  try {
    const { result } = await createCustomersWorkflow(container).run({
      input: { customersData: toCreate },
    })

    logger.info(
      `Created ${result.length} customer(s): ${result
        .map((c) => c.email)
        .join(", ")}`
    )
  } catch (e: any) {
    const msg = e?.message || String(e)
    logger.error(`Failed creating customers: ${msg}`)
  }
}
