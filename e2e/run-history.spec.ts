import { test, expect } from "./support/fixtures";
import { analysisRun, ingestionRun, SNAPSHOT_ID } from "./support/data";

test.describe("розділ запусків", () => {
  test("провалений збір називає свою причину", async ({ app, page }) => {
    await app.open(
      `/runs?snapshot=${SNAPSHOT_ID}`,
      {
        ListIngestionRuns: {
          runs: [
            ingestionRun("RUN_STATUS_FAILED", {
              failure: {
                code: "RUN_FAILURE_CODE_ACCOUNT_NOT_CONNECTED",
                message: "Облікові дані Telegram не налаштовані.",
              },
            }),
          ],
          page: {},
        },
        ListAnalysisRuns: { runs: [], page: {} },
      },
      "ROLE_ADMIN",
    );

    const collection = page.getByRole("article", { name: "Прогрес збору публікацій" });
    await expect(collection.getByText("Помилка")).toBeVisible();
    await expect(collection.getByText("Акаунт Telegram не підключено")).toBeVisible();
    await expect(collection.getByText("Облікові дані Telegram не налаштовані.")).toBeVisible();
  });

  test("успішний збір не показує причини", async ({ app, page }) => {
    await app.open(
      `/runs?snapshot=${SNAPSHOT_ID}`,
      {
        ListIngestionRuns: {
          runs: [ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29, postsIngested: 1160 })],
          page: {},
        },
        ListAnalysisRuns: { runs: [analysisRun("RUN_STATUS_SUCCEEDED")], page: {} },
      },
      "ROLE_ADMIN",
    );

    await expect(page.getByRole("article", { name: "Прогрес збору публікацій" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
