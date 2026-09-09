import { test, expect, expectNoHorizontalOverflow } from "./support/fixtures";
import { analysisRun, ingestionRun, snapshot } from "./support/data";

function settlesInto(collection: unknown, analysis: unknown) {
  return {
    ListSnapshots: { snapshots: [snapshot()], page: {} },
    ListIngestionRuns: { runs: [ingestionRun("RUN_STATUS_RUNNING")], page: {} },
    ListAnalysisRuns: { runs: [analysisRun("RUN_STATUS_RUNNING")], page: {} },
    GetIngestionRun: { run: collection },
    GetAnalysisRun: { run: analysis },
  };
}

const notConnected = {
  code: "RUN_FAILURE_CODE_ACCOUNT_NOT_CONNECTED",
  message: "Облікові дані Telegram не налаштовані.",
} as const;

test.describe("крок обробки імпорту", () => {
  test("провалений збір не подається як завершена робота", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_FAILED", { failure: notConnected }),
        analysisRun("RUN_STATUS_FAILED", {
          failure: {
            code: "RUN_FAILURE_CODE_COLLECTION_UNUSABLE",
            message: "Збір, за яким стояв аналіз, не дав придатних даних — аналізувати нема чого.",
          },
        }),
      ),
    );

    const collection = page.getByRole("region", { name: "Збір публікацій" });
    await expect(collection.getByText("Помилка")).toBeVisible();
    await expect(collection.getByText("Завершено", { exact: true })).toHaveCount(0);

    await expect(collection.getByText("Акаунт Telegram не підключено")).toBeVisible();
    await expect(collection.getByText("Облікові дані Telegram не налаштовані.")).toBeVisible();

    await expect(page.getByText("Обробку завершено", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Обробку не завершено")).toBeVisible();
    await expect(page.getByText("Не вдався етап «Збір публікацій»")).toBeVisible();
  });

  test("провалений збір веде до дії, що усуває причину", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_FAILED", { failure: notConnected }),
        analysisRun("RUN_STATUS_FAILED", {
          failure: {
            code: "RUN_FAILURE_CODE_COLLECTION_UNUSABLE",
            message: "Збір не дав придатних даних.",
          },
        }),
      ),
    );

    const connect = page.getByRole("link", { name: "Підключити акаунт Telegram" });
    await expect(connect).toBeVisible();
    await expect(connect).toHaveAttribute("href", /\/account/);
  });

  test("частковий збір відрізняється від успішного", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_PARTIAL", {
          channelsProcessed: 21,
          postsIngested: 840,
          failure: {
            code: "RUN_FAILURE_CODE_CHANNELS_FAILED",
            message: "Частину каналів не вдалося зібрати.",
          },
          channelErrors: [
            {
              channelId: "6f1f6f2a-0f9e-4a1a-9f1e-000000000009",
              channelUsername: "closed_channel",
              message: "Канал закрито.",
            },
          ],
        }),
        analysisRun("RUN_STATUS_SUCCEEDED", { candidatesFound: 3 }),
      ),
    );

    const collection = page.getByRole("region", { name: "Збір публікацій" });
    await expect(collection.getByText("Завершено частково")).toBeVisible();
    await expect(collection.getByText("Канали зібрати не вдалося")).toBeVisible();
    await expect(page.getByText("Обробку завершено", { exact: true })).toHaveCount(0);
  });

  test("успішна обробка пропонує ревізію", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29, postsIngested: 1160 }),
        analysisRun("RUN_STATUS_SUCCEEDED", { candidatesFound: 4 }),
      ),
    );

    await expect(page.getByText("Обробку завершено", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Перейти до ревізії" })).toBeVisible();
    await expect(page.getByText("Причини запуск не назвав")).toHaveCount(0);
  });

  test("успішний запуск не показує причини провалу", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29, postsIngested: 1160 }),
        analysisRun("RUN_STATUS_SUCCEEDED", { candidatesFound: 4 }),
      ),
    );

    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("крок обробки вміщується у вікно", async ({ app, page }) => {
    await app.open(
      "/import",
      settlesInto(
        ingestionRun("RUN_STATUS_FAILED", { failure: notConnected }),
        analysisRun("RUN_STATUS_FAILED", {
          failure: { code: "RUN_FAILURE_CODE_COLLECTION_UNUSABLE", message: "Збір не дав даних." },
        }),
      ),
    );

    await expect(page.getByText("Обробку не завершено")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
