import { test, expect } from "./support/fixtures";
import { analysisRun, channelProgress, ingestionRun } from "./support/data";

function withRuns(collection?: unknown, analysis?: unknown) {
  return {
    ListIngestionRuns: { runs: collection ? [collection] : [], page: {} },
    ListAnalysisRuns: { runs: analysis ? [analysis] : [], page: {} },
  };
}

test.describe("порожня ревізія", () => {
  test("аналіз виконався й не знайшов збігів", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29, postsIngested: 1160 }),
        analysisRun("RUN_STATUS_SUCCEEDED"),
      ),
    );

    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toBeVisible();
    await expect(page.getByText("Снапшот не оброблено.")).toHaveCount(0);
  });

  test("провалений збір не видається за відсутність дублювання", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_FAILED", {
          failure: {
            code: "RUN_FAILURE_CODE_ACCOUNT_NOT_CONNECTED",
            message: "Облікові дані Telegram не налаштовані.",
          },
        }),
        analysisRun("RUN_STATUS_FAILED", {
          failure: {
            code: "RUN_FAILURE_CODE_COLLECTION_UNUSABLE",
            message: "Збір, за яким стояв аналіз, не дав придатних даних.",
          },
        }),
      ),
    );

    await expect(page.getByText("Снапшот не оброблено.")).toBeVisible();
    await expect(page.getByText("Збір публікацій")).toBeVisible();
    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toHaveCount(0);
    await expect(page.getByText("Або аналіз")).toHaveCount(0);
  });

  test("аналіз, який ще не виконувався, відрізняється від обох", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29 }), undefined),
    );

    await expect(page.getByText("Аналіз цього снапшоту ще не виконувався.")).toBeVisible();
    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toHaveCount(0);
    await expect(page.getByText("Снапшот не оброблено.")).toHaveCount(0);
  });

  test("частковий збір названо частковим, а не провалом", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_PARTIAL", {
          channelsProcessed: 21,
          failure: {
            code: "RUN_FAILURE_CODE_CHANNELS_FAILED",
            message: "Частину каналів не вдалося зібрати.",
          },
        }),
        undefined,
      ),
    );

    await expect(page.getByText("Снапшот оброблено не повністю.")).toBeVisible();
    await expect(page.getByText("Снапшот не оброблено.")).toHaveCount(0);
  });

  test("завершений аналіз над частковим збором називає прогалину", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_PARTIAL", {
          channelsProcessed: 14,
          channels: [
            ...channelProgress("CHANNEL_INGESTION_STATE_DONE", 14),
            ...channelProgress("CHANNEL_INGESTION_STATE_REUSED", 7),
            ...channelProgress("CHANNEL_INGESTION_STATE_FAILED", 8),
          ],
          failure: {
            code: "RUN_FAILURE_CODE_CHANNELS_FAILED",
            message: "Частину каналів не вдалося зібрати.",
          },
        }),
        analysisRun("RUN_STATUS_SUCCEEDED"),
      ),
    );

    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toBeVisible();
    await expect(
      page.getByText("У порівняння увійшов 21 канал із 29 — збір завершився частково."),
    ).toBeVisible();
    await expect(page.getByText(/14 канал/)).toHaveCount(0);
  });

  test("повний збір лишає твердження без застережень", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_SUCCEEDED", {
          channelsProcessed: 29,
          channels: channelProgress("CHANNEL_INGESTION_STATE_DONE", 29),
          postsIngested: 1160,
        }),
        analysisRun("RUN_STATUS_SUCCEEDED"),
      ),
    );

    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toBeVisible();
    await expect(page.getByText(/збір завершився частково/i)).toHaveCount(0);
    await expect(page.getByText(/У порівняння увійш/)).toHaveCount(0);
  });

  test("частковий збір без стану каналів не отримує вигаданих чисел", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_PARTIAL", {
          channelsProcessed: 21,
          channels: [],
          failure: {
            code: "RUN_FAILURE_CODE_CHANNELS_FAILED",
            message: "Частину каналів не вдалося зібрати.",
          },
        }),
        analysisRun("RUN_STATUS_SUCCEEDED"),
      ),
    );

    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toBeVisible();
    await expect(
      page.getByText("Збір завершився частково — у порівняння увійшли не всі канали снапшоту."),
    ).toBeVisible();
    await expect(page.getByText(/із 29/)).toHaveCount(0);
    await expect(page.getByText(/21 канал/)).toHaveCount(0);
  });

  test("аналіз, що триває, не подається як порожній результат", async ({ app, page }) => {
    await app.open(
      "/review",
      withRuns(
        ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29 }),
        analysisRun("RUN_STATUS_RUNNING"),
      ),
    );

    await expect(page.getByText("Аналіз снапшоту ще триває.")).toBeVisible();
    await expect(page.getByText("Жодна пара каналів не має стійкого збігу.")).toHaveCount(0);
  });
});
