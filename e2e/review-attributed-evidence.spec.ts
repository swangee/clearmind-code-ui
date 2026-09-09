import { test, expect } from "./support/fixtures";
import { analysisRun, ingestionRun, snapshot, SNAPSHOT_ID } from "./support/data";

const LEFT = "4c000000-0000-4000-8000-000000000101";
const RIGHT = "4c000000-0000-4000-8000-000000000102";

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

function catalogChannel(id: string, username: string, title: string) {
  return { channel: { id, username, title }, hasProfile: false };
}

function candidate(attributed: unknown[], samples: unknown[]) {
  return {
    id: "cand-e2e-attributed",
    snapshotId: SNAPSHOT_ID,
    leftChannelId: LEFT,
    rightChannelId: RIGHT,
    relation: "RELATION_KIND_PERSISTENT_DUPLICATION",
    confidence: 1,
    hasSufficientData: true,
    algorithmVersion: "e2e",
    computedAt: secondsAgo(30),
    evidence: {
      matchRate: 1,
      earlierChannelId: RIGHT,
      medianDelaySeconds: 0,
      leftUniqueShare: 0.15,
      rightUniqueShare: 0.96,
      contentLossRisk: 0.15,
      signals: [
        {
          signal: "SIGNAL_KIND_FORWARD",
          value: 0.04,
          sampleSize: 270,
          explanation: "Частка публікацій, що є пересиланням із парного каналу.",
        },
        {
          signal: "SIGNAL_KIND_LEXICAL_OVERLAP",
          value: 0,
          sampleSize: 0,
          explanation: "Середня лексична схожість публікацій, визнаних збігом.",
        },
      ],
      samples,
      attributed,
    },
  };
}

const attributedEntry = { channelId: LEFT, attributedCount: 11, postCount: 13, share: 0.8462 };

const attributedSample = {
  leftChannelId: LEFT,
  leftPostForeignId: "1487",
  leftPublishedAt: secondsAgo(7200),
  leftExcerpt: "Верховна Рада має розглянути законопроєкт про незалежну експертизу вже цього тижня.",
  rightChannelId: RIGHT,
  rightPostForeignId: "3312",
  rightPublishedAt: secondsAgo(7205),
  rightExcerpt: "Верховна Рада має розглянути законопроєкт про незалежну експертизу вже цього тижня.",
  similarity: 0,
  attributed: true,
};

function reviewStubs(pair: unknown) {
  return {
    ListIngestionRuns: {
      runs: [ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 2, postsIngested: 270 })],
      page: {},
    },
    ListAnalysisRuns: { runs: [analysisRun("RUN_STATUS_SUCCEEDED", { candidatesFound: 1 })], page: {} },
    ListSnapshots: { snapshots: [snapshot()], page: {} },
    ListChannels: {
      channels: [
        catalogChannel(LEFT, "shabunin", "Шабунін"),
        catalogChannel(RIGHT, "cpk", "Центр протидії корупції"),
      ],
      page: {},
    },
    ListCandidates: { candidates: [pair], page: {} },
    ListClusters: { clusters: [{ id: "cl-1", candidateIds: ["cand-e2e-attributed"] }] },
    ListRecommendations: {
      recommendations: [
        {
          id: "rec-e2e-1",
          snapshotId: SNAPSHOT_ID,
          candidateId: "cand-e2e-attributed",
          subjectChannelId: LEFT,
          referenceChannelId: RIGHT,
          version: "1",
          rationale:
            "Канал повторює 100% публікацій парного каналу, здебільшого відкритими пересиланнями (11 із 13 публікацій), із затримкою близько 0 хв. Унікального контенту в ньому — 15%.",
          currentDecision: "DECISION_KIND_UNSPECIFIED",
          createdAt: secondsAgo(20),
        },
      ],
      page: {},
    },
    GetCandidate: { candidate: pair },
    ListUniquePosts: {
      posts: [
        {
          channelId: LEFT,
          postForeignId: "1490",
          publishedAt: secondsAgo(3600),
          excerpt: "Унікальний допис, який зникне зі стрічки разом із каналом.",
        },
      ],
      totalCount: 2,
    },
  };
}

test.describe("пара на відкритих пересиланнях", () => {
  test("вердикт пояснено блоком атрибуції, а репост позначено", async ({ app, page }) => {
    await app.open("/review", reviewStubs(candidate([attributedEntry], [attributedSample])));

    await page.getByRole("button", { name: /Шабунін/ }).last().click();

    await expect(page.getByText("Відкрите пересилання")).toBeVisible();
    await expect(page.getByText("11 із 13 публікацій — 85%")).toBeVisible();
    await expect(page.getByText(/оголошені репости з/)).toBeVisible();

    await expect(page.getByText("Сигнали прихованого копіювання")).toBeVisible();
    await expect(
      page.getByText("Для цієї пари прихованого копіювання не виявлено — нулі нижче справжні."),
    ).toBeVisible();

    await expect(page.getByText("Впевненість 100%")).toBeVisible();

    await expect(page.getByText("оголошене пересилання")).toBeVisible();
    await expect(page.getByText("Джерело вказане в самій публікації")).toBeVisible();
    await expect(page.getByText(/Схожість \d/)).toHaveCount(0);
  });

  test("пара без атрибуції виглядає як раніше", async ({ app, page }) => {
    const covertSample = { ...attributedSample, similarity: 0.93, attributed: false };
    await app.open("/review", reviewStubs(candidate([], [covertSample])));

    await page.getByRole("button", { name: /Шабунін/ }).last().click();

    await expect(page.getByText("Сигнали прихованого копіювання")).toBeVisible();
    await expect(page.getByText("Відкрите пересилання")).toHaveCount(0);
    await expect(page.getByText(/нулі нижче справжні/)).toHaveCount(0);
    await expect(page.getByText("Схожість 93%")).toBeVisible();
    await expect(page.getByText("оголошене пересилання")).toHaveCount(0);
  });
});
