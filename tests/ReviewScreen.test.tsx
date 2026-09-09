import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "@bufbuild/protobuf";

import {
  RunFailureCode,
  RunStatus,
} from "@clearmind/contracts/clearmind/v1/common_pb";
import { RelationKind, SignalKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";

import type { Clients } from "../src/lib/clients";
import { ReviewScreen } from "../src/screens/ReviewScreen";

const SNAPSHOT = "snap-1";
const PRIMARY = "2a000000-0000-4000-8000-000000000001";
const MIRROR = "2b000000-0000-4000-8000-000000000002";
const SPORT = "2c000000-0000-4000-8000-000000000003";
const SPORT_DIGEST = "2d000000-0000-4000-8000-000000000004";
const QUIET = "2e000000-0000-4000-8000-000000000005";

function catalogChannel(id: string, title: string, username: string) {
  return {
    channel: { id, title, username, foreignId: id },
    hasProfile: false,
    profile: undefined,
  };
}

function newsEvidence() {
  return {
    matchRate: 0.67,
    earlierChannelId: PRIMARY,
    medianDelaySeconds: 2100,
    leftUniqueShare: 0.33,
    rightUniqueShare: 0.18,
    contentLossRisk: 0.21,
    signals: [
      {
        signal: SignalKind.LEXICAL_OVERLAP,
        value: 0.91,
        sampleSize: 8,
        explanation: "Середня лексична схожість.",
      },
      {
        signal: SignalKind.SHARED_DOMAINS,
        value: 0.75,
        sampleSize: 22,
        explanation: "Частка спільних доменів.",
      },
    ],
    samples: [
      {
        leftChannelId: PRIMARY,
        leftPostForeignId: "1000",
        leftPublishedAt: undefined,
        leftExcerpt: "уряд ухвалив постанову про тарифи",
        rightChannelId: MIRROR,
        rightPostForeignId: "2000",
        rightPublishedAt: undefined,
        rightExcerpt: "уряд ухвалив постанову про тарифи",
        similarity: 0.98,
      },
      {
        leftChannelId: PRIMARY,
        leftPostForeignId: "1001",
        leftPublishedAt: undefined,
        leftExcerpt: "курс валют на завтра",
        rightChannelId: MIRROR,
        rightPostForeignId: "2001",
        rightPublishedAt: undefined,
        rightExcerpt: "курс валют на завтра",
        similarity: 0.94,
      },
    ],
  };
}

function sportEvidence() {
  return {
    matchRate: 0.41,
    earlierChannelId: SPORT,
    medianDelaySeconds: 600,
    leftUniqueShare: 0.5,
    rightUniqueShare: 0.44,
    contentLossRisk: 0.4,
    signals: [
      {
        signal: SignalKind.TIMING,
        value: 0.52,
        sampleSize: 3,
        explanation: "Часовий профіль публікацій.",
      },
    ],
    samples: [],
  };
}

function newsCandidate() {
  return {
    id: "cand-news",
    snapshotId: SNAPSHOT,
    leftChannelId: PRIMARY,
    rightChannelId: MIRROR,
    relation: RelationKind.PERSISTENT_DUPLICATION,
    confidence: 0.88,
    hasSufficientData: true,
    algorithmVersion: "v1",
    evidence: newsEvidence(),
    hasMatchOverride: false,
    matchHistory: [],
  };
}

function sportCandidate() {
  return {
    id: "cand-sport",
    snapshotId: SNAPSHOT,
    leftChannelId: SPORT,
    rightChannelId: SPORT_DIGEST,
    relation: RelationKind.INSUFFICIENT_DATA,
    confidence: 0,
    hasSufficientData: false,
    algorithmVersion: "v1",
    evidence: sportEvidence(),
    hasMatchOverride: false,
    matchHistory: [],
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    snapshotId: SNAPSHOT,
    candidateId: "cand-news",
    subjectChannelId: MIRROR,
    referenceChannelId: PRIMARY,
    version: 1n,
    rationale: "«Новини Дзеркало» дублює «Новини Первинні».",
    evidence: newsEvidence(),
    currentDecision: DecisionKind.UNSPECIFIED,
    createdAt: undefined,
    ...overrides,
  };
}

function uniquePosts() {
  return [
    {
      channelId: MIRROR,
      postForeignId: "2100",
      publishedAt: Timestamp.fromDate(new Date("2026-08-10T09:15:00Z")),
      excerpt: "репортаж із відкриття міської бібліотеки",
    },
    {
      channelId: MIRROR,
      postForeignId: "2099",
      publishedAt: Timestamp.fromDate(new Date("2026-08-09T18:40:00Z")),
      excerpt: "інтервʼю з директором комунального підприємства",
    },
  ];
}

function ingestionRun(over: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    snapshotId: SNAPSHOT,
    status: RunStatus.SUCCEEDED,
    windowDays: 30,
    channelsTotal: 5,
    channelsProcessed: 5,
    postsIngested: 980,
    rateLimitWaits: 0,
    channelErrors: [],
    channels: [],
    ...over,
  };
}

function analysisRun(over: Record<string, unknown> = {}) {
  return {
    id: "arun-1",
    snapshotId: SNAPSHOT,
    status: RunStatus.SUCCEEDED,
    postsAnalyzed: 980,
    pairsCompared: 10,
    candidatesFound: 0,
    channelErrors: [],
    stages: [],
    ...over,
  };
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const listSnapshots = vi.fn().mockResolvedValue({
    snapshots: [{ id: SNAPSHOT, version: 1n, frozenAt: undefined, memberCount: 5 }],
  });
  const listCandidates = vi
    .fn()
    .mockResolvedValue({ candidates: [newsCandidate(), sportCandidate()] });
  const listClusters = vi.fn().mockResolvedValue({
    clusters: [
      {
        id: "cluster-1",
        snapshotId: SNAPSHOT,
        channelIds: [PRIMARY, MIRROR, SPORT, SPORT_DIGEST],
        candidateIds: ["cand-news", "cand-sport"],
      },
    ],
  });
  const getCandidate = vi
    .fn()
    .mockImplementation(async ({ candidateId }: { candidateId: string }) => ({
      candidate: candidateId === "cand-news" ? newsCandidate() : sportCandidate(),
    }));
  const listChannels = vi.fn().mockResolvedValue({
    channels: [
      catalogChannel(PRIMARY, "Новини Первинні", "primary"),
      catalogChannel(MIRROR, "Новини Дзеркало", "mirror"),
      catalogChannel(SPORT, "Дайджест Спорту", "sportdigest"),
      catalogChannel(SPORT_DIGEST, "Спорт Онлайн", "sport"),
      catalogChannel(QUIET, "Рецепти", "recipes"),
    ],
  });
  const listUniquePosts = vi
    .fn()
    .mockResolvedValue({ posts: uniquePosts(), page: { nextPageToken: "" }, totalCount: 14 });
  const getAnalysisSettings = vi.fn().mockResolvedValue({ settings: { collectionWindowDays: 30 } });
  const listRecommendations = vi.fn().mockResolvedValue({ recommendations: [recommendation()] });
  const submitDecision = vi.fn().mockImplementation(async (request: { decision: DecisionKind }) => ({
    decision: { id: "dec-1", decision: request.decision },
    recommendation: recommendation({ currentDecision: request.decision }),
  }));

  const listIngestionRuns = vi
    .fn()
    .mockResolvedValue({ runs: [ingestionRun()] });
  const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [analysisRun()] });

  const clients = {
    subscription: { listSnapshots },
    ingestion: { listIngestionRuns },
    duplication: {
      listCandidates,
      listClusters,
      getCandidate,
      listUniquePosts,
      listAnalysisRuns,
    },
    catalog: { listChannels },
    recommendation: { listRecommendations, submitDecision },
    analysisSettings: { getAnalysisSettings },
    ...overrides,
  } as unknown as Clients;

  return {
    clients,
    listSnapshots,
    listCandidates,
    listClusters,
    getCandidate,
    listUniquePosts,
    listChannels,
    listRecommendations,
    submitDecision,
    getAnalysisSettings,
    listIngestionRuns,
    listAnalysisRuns,
  };
}

async function openNewsPair() {
  await userEvent.click(
    await screen.findByRole("button", { name: /Новини Дзеркало.*Показати докази/s }),
  );
}

describe("екран ревізії підписок", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показує знайдені пари останнього снапшоту", async () => {
    const { clients, listCandidates } = makeClients();

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByRole("heading", { name: "Ревізія підписок" })).toBeInTheDocument();
    expect(await screen.findByText("Знайдене дублювання")).toBeInTheDocument();
    await waitFor(() =>
      expect(listCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotId: SNAPSHOT }),
      ),
    );
  });

  it("незалежні пари не рахуються як знайдене дублювання", async () => {
    const independent = {
      ...newsCandidate(),
      id: "cand-independent",
      relation: RelationKind.INDEPENDENT,
      confidence: 0,
    };
    const { clients, listCandidates } = makeClients();
    listCandidates.mockResolvedValue({ candidates: [independent] });

    render(<ReviewScreen clients={clients} />);

    await screen.findByRole("heading", { name: "Ревізія підписок" });
    expect(await screen.findByText("1 пар оцінено · 0 із дублюванням")).toBeInTheDocument();

    const summary = screen.getByText("пар із дублюванням").closest("div");
    expect(summary).toHaveTextContent("0");
  });

  it("зведення рахує лише пари зі справжнім дублюванням", async () => {
    const partial = {
      ...newsCandidate(),
      id: "cand-partial",
      relation: RelationKind.PARTIAL_OVERLAP,
    };
    const independent = {
      ...newsCandidate(),
      id: "cand-independent",
      relation: RelationKind.INDEPENDENT,
    };
    const { clients, listCandidates } = makeClients();
    listCandidates.mockResolvedValue({
      candidates: [newsCandidate(), partial, independent, sportCandidate()],
    });

    render(<ReviewScreen clients={clients} />);

    await screen.findByRole("heading", { name: "Ревізія підписок" });
    expect(await screen.findByText("4 пар оцінено · 2 із дублюванням")).toBeInTheDocument();
  });

  it("завжди показує межу продукту", async () => {
    const { clients } = makeClients();

    render(<ReviewScreen clients={clients} />);

    expect(
      await screen.findByText(/не доводить комерційного чи пропагандистського наміру/),
    ).toBeInTheDocument();
  });

  it("тримає докази пари згорнутими, доки їх не розкриють", async () => {
    const { clients } = makeClients();

    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    expect(screen.queryByText("Лексичний збіг")).not.toBeInTheDocument();
  });

  it("розкриває сигнали роздільно, а не одним числом", async () => {
    const { clients, getCandidate } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    expect(await screen.findByText("Лексичний збіг")).toBeInTheDocument();
    expect(screen.getByText("Спільні домени")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    await waitFor(() =>
      expect(getCandidate).toHaveBeenCalledWith({ candidateId: "cand-news" }),
    );
  });

  it("показує приклад збігу з обох каналів пари", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    const example = (await screen.findByText("Приклад збігу")).closest("section") as HTMLElement;
    expect(within(example).getByText(/Новини Первинні/)).toBeInTheDocument();
    expect(within(example).getByText(/Новини Дзеркало/)).toBeInTheDocument();
    expect(within(example).getAllByText("уряд ухвалив постанову про тарифи")).toHaveLength(2);
  });

  it("показує, що буде втрачено разом із каналом, який пропонується зняти", async () => {
    const { clients, listUniquePosts } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    const loss = (
      await screen.findByText("Це ви втратите, якщо відпишетесь від Новини Дзеркало")
    ).closest("section") as HTMLElement;
    expect(
      within(loss).getByText("репортаж із відкриття міської бібліотеки"),
    ).toBeInTheDocument();
    expect(
      within(loss).getByText("інтервʼю з директором комунального підприємства"),
    ).toBeInTheDocument();
    expect(within(loss).getByText("14 унікальних публікацій за 30 днів")).toBeInTheDocument();
    await waitFor(() =>
      expect(listUniquePosts).toHaveBeenCalledWith(
        expect.objectContaining({ candidateId: "cand-news", channelId: MIRROR }),
      ),
    );
  });

  it("показує дату кожної унікальної публікації поруч із текстом", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    const loss = (
      await screen.findByText("Це ви втратите, якщо відпишетесь від Новини Дзеркало")
    ).closest("section") as HTMLElement;
    const line = within(loss)
      .getByText("репортаж із відкриття міської бібліотеки")
      .closest("div") as HTMLElement;
    expect(line).toHaveTextContent(/\d{2}\.\d{2}\.\d{2}/);
  });

  it("не запитує перелік втрати, доки пару не розкрито", async () => {
    const { clients, listUniquePosts } = makeClients();

    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    expect(listUniquePosts).not.toHaveBeenCalled();
  });

  it("лишає частки, коли перелік унікальних публікацій недоступний", async () => {
    const { clients, listUniquePosts } = makeClients();
    listUniquePosts.mockRejectedValue(new Error("сервіс недоступний"));
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    expect(
      await screen.findByText("Це ви втратите, якщо відпишетесь від Новини Дзеркало"),
    ).toBeInTheDocument();
    expect(screen.getByText(/18% публікацій цього каналу/)).toBeInTheDocument();
    expect(screen.getByText("Лексичний збіг")).toBeInTheDocument();
  });

  it("не вигадує вікна збору, коли параметри аналізу недоступні", async () => {
    const { clients, getAnalysisSettings } = makeClients();
    getAnalysisSettings.mockRejectedValue(new Error("нема"));
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    expect(
      await screen.findByText("14 унікальних публікацій за вікно збору снапшоту"),
    ).toBeInTheDocument();
  });

  it("не пропонує до зняття пару з недостатніми даними", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await userEvent.click(
      await screen.findByRole("button", { name: /Дайджест Спорту.*Показати докази/s }),
    );

    expect(await screen.findByText(/Даних для цієї пари недостатньо/)).toBeInTheDocument();
    expect(screen.getByText("Впевненість не остаточна")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Відписатись від/ })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Це ви втратите, якщо відпишетесь від Дайджест Спорту/),
    ).not.toBeInTheDocument();
  });

  it("перемикає подання на суцільний перелік пар і назад", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await userEvent.click(screen.getByLabelText("Усі пари підряд"));

    expect(screen.getByRole("columnheader", { name: "Пара каналів" })).toBeInTheDocument();
    expect(screen.getByText("Новини Первинні ↔ Новини Дзеркало")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("За тематикою"));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("сортує суцільний перелік за часткою збігів або за назвою каналу", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");
    await userEvent.click(screen.getByLabelText("Усі пари підряд"));

    const byOverlap = screen.getAllByRole("row").slice(1);
    expect(byOverlap[0]).toHaveTextContent("Новини Первинні ↔ Новини Дзеркало");

    await userEvent.click(screen.getByLabelText("За назвою каналу"));

    const byName = screen.getAllByRole("row").slice(1);
    expect(byName[0]).toHaveTextContent("Дайджест Спорту");
  });

  it("надсилає рішення «відписатись» через контракт", async () => {
    const { clients, submitDecision } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");
    await openNewsPair();

    await userEvent.click(
      await screen.findByRole("button", { name: "Відписатись від Новини Дзеркало" }),
    );

    await waitFor(() =>
      expect(submitDecision).toHaveBeenCalledWith({
        recommendationId: "rec-1",
        recommendationVersion: 1n,
        decision: DecisionKind.CONFIRMED,
      }),
    );
    expect(await screen.findByText("Підтверджено")).toBeInTheDocument();
  });

  it.each([
    ["Залишити обидва", DecisionKind.REJECTED],
    ["Відкласти", DecisionKind.DEFERRED],
  ])("надсилає рішення «%s»", async (label, expected) => {
    const { clients, submitDecision } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");
    await openNewsPair();

    await userEvent.click(await screen.findByRole("button", { name: label }));

    await waitFor(() =>
      expect(submitDecision).toHaveBeenCalledWith(
        expect.objectContaining({ recommendationId: "rec-1", decision: expected }),
      ),
    );
  });

  it("нагадує, що відписка виконується вручну", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    expect(await screen.findByText(/вручну в Telegram/)).toBeInTheDocument();
  });

  it("показує помилку, якщо рішення не збереглося", async () => {
    const { clients, submitDecision } = makeClients();
    submitDecision.mockRejectedValueOnce(new Error("сервіс недоступний"));
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");
    await openNewsPair();

    await userEvent.click(await screen.findByRole("button", { name: "Залишити обидва" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");
  });

  it("пояснює порожній розділ, коли снапшоту ще немає", async () => {
    const { clients, listSnapshots } = makeClients();
    listSnapshots.mockResolvedValue({ snapshots: [] });

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText("Снапшот підписок ще не створено.")).toBeInTheDocument();
  });

  it("аналіз, що дійшов до кінця й нічого не знайшов, так і називається", async () => {
    const { clients, listCandidates } = makeClients();
    listCandidates.mockResolvedValue({ candidates: [] });

    render(<ReviewScreen clients={clients} />);

    expect(
      await screen.findByText("Жодна пара каналів не має стійкого збігу."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Або аналіз/)).not.toBeInTheDocument();
  });

  it("провалений збір названо провалом, а не відсутністю дублювання", async () => {
    const { clients, listCandidates, listIngestionRuns, listAnalysisRuns } =
      makeClients();
    listCandidates.mockResolvedValue({ candidates: [] });
    listIngestionRuns.mockResolvedValue({
      runs: [
        ingestionRun({
          status: RunStatus.FAILED,
          channelsProcessed: 0,
          postsIngested: 0,
          failure: {
            code: RunFailureCode.ACCOUNT_NOT_CONNECTED,
            message: "Акаунт Telegram не підключено.",
          },
        }),
      ],
    });
    listAnalysisRuns.mockResolvedValue({
      runs: [analysisRun({ status: RunStatus.FAILED })],
    });

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText("Снапшот не оброблено.")).toBeInTheDocument();
    expect(
      screen.getByText(/Етап «Збір публікацій» не вдався/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Акаунт Telegram не підключено/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/стійкого збігу/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listIngestionRuns).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotId: SNAPSHOT }),
      ),
    );
  });

  it("снапшот без аналізу відрізняється і від провалу, і від порожньої знахідки", async () => {
    const { clients, listCandidates, listAnalysisRuns } = makeClients();
    listCandidates.mockResolvedValue({ candidates: [] });
    listAnalysisRuns.mockResolvedValue({ runs: [] });

    render(<ReviewScreen clients={clients} />);

    expect(
      await screen.findByText("Аналіз цього снапшоту ще не виконувався."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/стійкого збігу/)).not.toBeInTheDocument();
    expect(screen.queryByText("Снапшот не оброблено.")).not.toBeInTheDocument();
  });

  it("аналіз, який ще триває, не подається як виконаний", async () => {
    const { clients, listCandidates, listAnalysisRuns } = makeClients();
    listCandidates.mockResolvedValue({ candidates: [] });
    listAnalysisRuns.mockResolvedValue({
      runs: [analysisRun({ status: RunStatus.RUNNING })],
    });

    render(<ReviewScreen clients={clients} />);

    expect(
      await screen.findByText("Аналіз снапшоту ще триває."),
    ).toBeInTheDocument();
  });

  it("недосяжний перелік запусків не ламає ревізію", async () => {
    const { clients, listCandidates, listIngestionRuns, listAnalysisRuns } =
      makeClients();
    listCandidates.mockResolvedValue({ candidates: [] });
    listIngestionRuns.mockRejectedValue(new Error("сервіс недоступний"));
    listAnalysisRuns.mockRejectedValue(new Error("сервіс недоступний"));

    render(<ReviewScreen clients={clients} />);

    expect(
      await screen.findByText("Аналіз цього снапшоту ще не виконувався."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("дає повторити запит після помилки завантаження", async () => {
    const { clients, listSnapshots } = makeClients();
    listSnapshots.mockRejectedValueOnce(new Error("сервіс недоступний"));

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Знайдене дублювання")).toBeInTheDocument();
  });
});

describe("ревізія підписок: повнота вибірки", () => {
  beforeEach(() => vi.clearAllMocks());

  it("дочитує пари до кінця, а не лише першу сторінку", async () => {
    const { clients, listCandidates } = makeClients();
    listCandidates
      .mockResolvedValueOnce({
        candidates: [newsCandidate()],
        page: { nextPageToken: "cursor-2" },
      })
      .mockResolvedValueOnce({ candidates: [sportCandidate()], page: { nextPageToken: "" } });

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText(/2 пар оцінено/)).toBeInTheDocument();
    await waitFor(() =>
      expect(listCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ page: expect.objectContaining({ pageToken: "cursor-2" }) }),
      ),
    );
  });

  it("не видає обірвану вибірку за підсумок снапшоту", async () => {
    const { clients, listCandidates } = makeClients();
    listCandidates.mockResolvedValue({
      candidates: [newsCandidate()],
      page: { nextPageToken: "cursor-stuck" },
    });

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText(/щонайменше/)).toBeInTheDocument();
  });
});

describe("ревізія підписок: канали поза порівнянням", () => {
  beforeEach(() => vi.clearAllMocks());

  it("називає відсутність порівняння, а не відсутність дублювання", async () => {
    const { clients } = makeClients();

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText("Не порівнювалися")).toBeInTheDocument();
    expect(screen.getByText("Немає публікацій за вікно збору")).toBeInTheDocument();
    expect(screen.queryByText("Дублювання не виявлено")).not.toBeInTheDocument();
  });

  it("не приписує причини каналу, вміст якого виміряно", async () => {
    const { clients, listChannels } = makeClients();
    listChannels.mockResolvedValue({
      channels: [
        catalogChannel(PRIMARY, "Новини Первинні", "primary"),
        catalogChannel(MIRROR, "Новини Дзеркало", "mirror"),
        catalogChannel(SPORT, "Дайджест Спорту", "sportdigest"),
        catalogChannel(SPORT_DIGEST, "Спорт Онлайн", "sport"),
        { ...catalogChannel(QUIET, "Рецепти", "recipes"), hasProfile: true, profile: undefined },
      ],
    });

    render(<ReviewScreen clients={clients} />);

    expect(await screen.findByText("Не увійшли в жодну пару")).toBeInTheDocument();
  });
});

describe("ревізія підписок: склад груп", () => {
  beforeEach(() => vi.clearAllMocks());

  it("не рахує той самий канал двічі в підписах груп", async () => {
    const { clients, listCandidates, listClusters } = makeClients();
    const crossCandidate = {
      ...newsCandidate(),
      id: "cand-cross",
      leftChannelId: PRIMARY,
      rightChannelId: SPORT,
    };
    listCandidates.mockResolvedValue({
      candidates: [newsCandidate(), sportCandidate(), crossCandidate],
    });
    listClusters.mockResolvedValue({
      clusters: [
        {
          id: "cluster-1",
          snapshotId: SNAPSHOT,
          channelIds: [PRIMARY, MIRROR],
          candidateIds: ["cand-news"],
        },
      ],
    });

    render(<ReviewScreen clients={clients} />);

    const outside = await screen.findByText("Поза групами");
    const counts = await screen.findAllByText(/^\d+ каналів$/);
    const total = counts.reduce((sum, node) => sum + Number(node.textContent!.split(" ")[0]), 0);

    expect(outside).toBeInTheDocument();
    expect(total).toBeLessThanOrEqual(5);
  });
});

describe("ревізія підписок: відкрите пересилання", () => {
  beforeEach(() => vi.clearAllMocks());

  function forwardEvidence() {
    return {
      ...newsEvidence(),
      attributed: [
        { channelId: MIRROR, attributedCount: 11, postCount: 13, share: 11 / 13 },
      ],
    };
  }

  it("показує блок відкритого пересилання з кількістю і часткою", async () => {
    const { clients, listCandidates, getCandidate } = makeClients();
    const candidate = { ...newsCandidate(), evidence: forwardEvidence() };
    listCandidates.mockResolvedValue({ candidates: [candidate, sportCandidate()] });
    getCandidate.mockResolvedValue({ candidate });
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    expect(await screen.findByText("Відкрите пересилання")).toBeInTheDocument();
    expect(screen.getByText("11 із 13 публікацій — 85%")).toBeInTheDocument();
    expect(
      screen.getByText(/Публікації «Новини Дзеркало» — оголошені репости з «Новини Первинні»/),
    ).toBeInTheDocument();
  });

  it("не показує блока для пари без записів атрибуції", async () => {
    const { clients } = makeClients();
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    await screen.findByText("Лексичний збіг");
    expect(screen.queryByText("Відкрите пересилання")).not.toBeInTheDocument();
    expect(screen.getByText("Сигнали прихованого копіювання")).toBeInTheDocument();
  });

  it("позначає атрибутований приклад замість числа схожості", async () => {
    const { clients, listCandidates, getCandidate } = makeClients();
    const evidence = {
      ...forwardEvidence(),
      samples: [{ ...newsEvidence().samples[0], similarity: 0, attributed: true }],
    };
    const candidate = { ...newsCandidate(), evidence };
    listCandidates.mockResolvedValue({ candidates: [candidate, sportCandidate()] });
    getCandidate.mockResolvedValue({ candidate });
    render(<ReviewScreen clients={clients} />);
    await screen.findByText("Знайдене дублювання");

    await openNewsPair();

    const example = (await screen.findByText("Приклад збігу")).closest("section") as HTMLElement;
    expect(within(example).getByText("оголошене пересилання")).toBeInTheDocument();
    expect(within(example).getByText("Джерело вказане в самій публікації")).toBeInTheDocument();
    expect(within(example).queryByText(/Схожість/)).not.toBeInTheDocument();
  });
});
