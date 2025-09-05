import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

jest.setTimeout(90 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("Internal Metrics", () => {
      it("GET /internal/metrics returns JSON summary", async () => {
        const res = await api.get("/internal/metrics");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("application/json");
        expect(res.data).toHaveProperty("totals");
        expect(res.data).toHaveProperty("byTool");
      });
    });
  },
});
