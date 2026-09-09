import { Timestamp } from "@bufbuild/protobuf";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";
import {
  MatchEventKind,
  MatchVerdict,
  RelationKind,
  SignalKind,
} from "@clearmind/contracts/clearmind/v1/duplication_pb";

import type { Clients } from "../src/lib/clients";
import { PairsScreen } from "../src/screens/PairsScreen";

const SNAPSHOT = "11111111-1111-1111-1111-111111111111";
const PRIMARY = "2a000000-0000-4000-8000-000000000001";
const MIRROR = "2b000000-0000-4000-8000-000000000002";
const DIGEST = "2c000000-0000-4000-8000-000000000003";
const WIRE = "2d000000-0000-4000-8000-000000000004";

const DECIDED_AT = Timestamp.fromDate(new Date("2026-03-01T10:00:00Z"));

function channel(id: string, title: string, username: string) {
  return {
    channel: { id, socialMediaType: SocialMediaType.TELEGRAM, foreignId: id, username, title },
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    matchRate: 0.67,
    earlierChannelId: PRIMARY,
    medianDelaySeconds: 2100,
    leftUniqueShare: 0.33,
    rightUniqueShare: 0.18,
    contentLossRisk: 0.18,
    signals: [
      {
        signal: SignalKind.LEXICAL_OVERLAP,
        value: 0.91,
        sampleSize: 40,
        explanation: "Середня лексична схожість.",
      },
      { signal: SignalKind.SHARED_LINKS, value: 0.74, sampleSize: 40, explanation: "Спільні посилання." },
      { signal: SignalKind.FORWARD, value: 0.12, sampleSize: 40, explanation: "Частка пересилань." },
      { signal: SignalKind.TIMING, value: 0.55, sampleSize: 40, explanation: "Часовий профіль." },
    ],
    samples: [
      {
        leftChannelId: PRIMARY,
        leftPostForeignId: "1000",
        leftPublishedAt: Timestamp.fromDate(new Date("2026-03-01T08:00:00Z")),
        leftExcerpt: "уряд ухвалив постанову про тарифи",
        rightChannelId: MIRROR,
        rightPostForeignId: "2000",
        rightPublishedAt: Timestamp.fromDate(new Date("2026-03-01T08:30:00Z")),
        rightExcerpt: "уряд ухвалив постанову про тарифи",
        similarity: 0.98,
      },
    ],
    ...overrides,
  };
}

function autoCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    snapshotId: SNAPSHOT,
    leftChannelId: PRIMARY,
    rightChannelId: MIRROR,
    relation: RelationKind.PERSISTENT_DUPLICATION,
    confidence: 0.82,
    hasSufficientData: true,
    algorithmVersion: "v1",
    evidence: evidence(),
    computedAt: DECIDED_AT,
    hasMatchOverride: false,
    matchOverride: undefined,
    matchHistory: [],
    ...overrides,
  };
}

function manualCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-2",
    snapshotId: SNAPSHOT,
    leftChannelId: DIGEST,
    rightChannelId: WIRE,
    relation: RelationKind.PARTIAL_OVERLAP,
    confidence: 0.41,
    hasSufficientData: true,
    algorithmVersion: "v1",
    evidence: evidence({ samples: [] }),
    computedAt: DECIDED_AT,
    hasMatchOverride: true,
    matchOverride: {
      verdict: MatchVerdict.NOT_DUPLICATE,
      appUserId: "user-9",
      appUsername: "olena",
      decidedAt: DECIDED_AT,
    },
    matchHistory: [
      {
        id: "hist-1",
        kind: MatchEventKind.MARKED_NOT_DUPLICATE,
        appUserId: "user-9",
        appUsername: "olena",
        occurredAt: DECIDED_AT,
      },
    ],
    ...overrides,
  };
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const candidates = [autoCandidate(), manualCandidate()];

  const listCandidates = vi.fn().mockResolvedValue({ candidates, page: {} });
  const listClusters = vi.fn().mockResolvedValue({
    clusters: [
      {
        id: "3f000000-0000-4000-8000-00000000000c",
        snapshotId: SNAPSHOT,
        channelIds: [PRIMARY, MIRROR],
        candidateIds: ["cand-1"],
      },
    ],
    page: {},
  });
  const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [{ id: "run-77770000" }], page: {} });
  const getCandidate = vi
    .fn()
    .mockImplementation(async ({ candidateId }: { candidateId: string }) => ({
      candidate: candidates.find((item) => item.id === candidateId),
    }));
  const setCandidateMatch = vi
    .fn()
    .mockImplementation(
      async ({ candidateId, verdict }: { candidateId: string; verdict: MatchVerdict }) => ({
        candidate: {
          ...(candidates.find((item) => item.id === candidateId) ?? autoCandidate()),
          hasMatchOverride: true,
          matchOverride: {
            verdict,
            appUserId: "user-1",
            appUsername: "admin",
            decidedAt: DECIDED_AT,
          },
        },
      }),
    );
  const resetCandidateMatch = vi.fn().mockImplementation(async () => ({
    candidate: { ...manualCandidate(), hasMatchOverride: false, matchOverride: undefined },
  }));

  const clients = {
    duplication: {
      listCandidates,
      listClusters,
      listAnalysisRuns,
      getCandidate,
      setCandidateMatch,
      resetCandidateMatch,
      ...(overrides.duplication as object),
    },
    catalog: {
      listChannels: vi.fn().mockResolvedValue({
        channels: [
          channel(PRIMARY, "Новини Первинні", "prime"),
          channel(MIRROR, "Новини Дзеркало", "mirror"),
          channel(DIGEST, "Дайджест", "digest"),
          channel(WIRE, "Стрічка", "wire"),
        ],
        page: {},
      }),
    },
    subscription: { listSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }) },
  } as unknown as Clients;

  return {
    clients,
    listCandidates,
    getCandidate,
    setCandidateMatch,
    resetCandidateMatch,
  };
}

function renderScreen(clients: Clients, entry = `/pairs?snapshot=${SNAPSHOT}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PairsScreen clients={clients} />
    </MemoryRouter>,
  );
}

function rowOf(title: string | RegExp) {
  return screen.getByText(title).closest("tr") as HTMLElement;
}

describe("екран пар каналів", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показує пари снапшоту з назвами каналів і сигналами", async () => {
    const { clients } = makeClients();

    renderScreen(clients);

    expect(await screen.findByText("Новини Первинні ↔ Новини Дзеркало")).toBeInTheDocument();
    const row = rowOf("Новини Первинні ↔ Новини Дзеркало");
    expect(within(row).getByText("91%")).toBeInTheDocument();
    expect(within(row).getByText("74%")).toBeInTheDocument();
    expect(within(row).getByText("82%")).toBeInTheDocument();
    expect(within(row).getByText("Стійке дублювання")).toBeInTheDocument();
  });

  it("показує малий ненульовий сигнал як «<1%», а справжній нуль — як «0%»", async () => {
    const tiny = autoCandidate({
      evidence: evidence({
        signals: [
          {
            signal: SignalKind.LEXICAL_OVERLAP,
            value: 0.91,
            sampleSize: 40,
            explanation: "Середня лексична схожість.",
          },
          { signal: SignalKind.SHARED_LINKS, value: 0, sampleSize: 40, explanation: "Спільні посилання." },
          { signal: SignalKind.FORWARD, value: 0.003, sampleSize: 40, explanation: "Частка пересилань." },
          { signal: SignalKind.TIMING, value: 0.55, sampleSize: 40, explanation: "Часовий профіль." },
        ],
      }),
    });
    const { clients } = makeClients({
      duplication: {
        listCandidates: vi.fn().mockResolvedValue({ candidates: [tiny], page: {} }),
        getCandidate: vi.fn().mockResolvedValue({ candidate: tiny }),
      },
    });

    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    const row = rowOf("Новини Первинні ↔ Новини Дзеркало");
    expect(within(row).getByText("<1%")).toBeInTheDocument();
    expect(within(row).getByText("0%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Пересилання");
    expect(dialog.querySelectorAll('div[style*="width: 1%"]').length).toBeGreaterThan(0);
    expect(within(dialog).getByText("<1%")).toBeInTheDocument();
  });

  it("рахує пари, що перевищують поріг, і змінені вручну", async () => {
    const { clients } = makeClients();

    renderScreen(clients);

    expect(
      await screen.findByText(/2 пар оцінено в запуску #run-7777… · 1 перевищують поріг · 1 змінено вручну/),
    ).toBeInTheDocument();
  });

  it("відрізняє ручний матчінг від автоматичного", async () => {
    const { clients } = makeClients();

    renderScreen(clients);
    await screen.findByText("Дайджест ↔ Стрічка");

    const manual = rowOf("Дайджест ↔ Стрічка");
    expect(within(manual).getByText("Не дубль", { selector: "span.tag" })).toBeInTheDocument();
    expect(within(manual).getByText(/Вручну · olena/)).toBeInTheDocument();

    const auto = rowOf("Новини Первинні ↔ Новини Дзеркало");
    expect(within(auto).getByText("Автоматично")).toBeInTheDocument();
  });

  it("зберігає ручне рішення і позначає пару як змінену вручну", async () => {
    const { clients, setCandidateMatch } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    const row = rowOf("Новини Первинні ↔ Новини Дзеркало");
    await userEvent.click(within(row).getByRole("radio", { name: "Дубль" }));

    await waitFor(() =>
      expect(setCandidateMatch).toHaveBeenCalledWith({
        candidateId: "cand-1",
        verdict: MatchVerdict.DUPLICATE,
      }),
    );
    const updated = rowOf("Новини Первинні ↔ Новини Дзеркало");
    expect(await within(updated).findByText(/Вручну · admin/)).toBeInTheDocument();
    expect(within(updated).queryByText("Стійке дублювання")).not.toBeInTheDocument();
  });

  it("фільтрує пари за походженням матчінгу", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    await userEvent.click(screen.getByRole("radio", { name: "Змінені вручну" }));

    expect(screen.getByText("Дайджест ↔ Стрічка")).toBeInTheDocument();
    expect(screen.queryByText("Новини Первинні ↔ Новини Дзеркало")).not.toBeInTheDocument();
  });

  it("відкриває панель пари як діалог і переводить у неї фокус", async () => {
    const { clients, getCandidate } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    await userEvent.click(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole("heading", { level: 4 })).toHaveTextContent(
      "Новини Первинні ↔ Новини Дзеркало",
    );
    expect(getCandidate).toHaveBeenCalledWith({ candidateId: "cand-1" });
  });

  it("закриває панель клавішею Escape", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");
    await userEvent.click(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ })).toHaveFocus();
  });

  it("веде до сусідньої пари стрілками", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");
    await userEvent.click(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 з 2")).toBeInTheDocument();

    await userEvent.keyboard("{ArrowDown}");

    expect(await screen.findByText("2 з 2")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", { level: 4 }),
    ).toHaveTextContent("Дайджест ↔ Стрічка");

    await userEvent.keyboard("{ArrowUp}");

    expect(await screen.findByText("1 з 2")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", { level: 4 }),
    ).toHaveTextContent("Новини Первинні ↔ Новини Дзеркало");
  });

  it("пропонує повернути автоматичний матчінг лише за наявності ручного рішення", async () => {
    const { clients, resetCandidateMatch } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    await userEvent.click(screen.getByRole("button", { name: /Новини Первинні ↔ Новини Дзеркало/ }));
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: "Повернути автоматичний" }),
    ).not.toBeInTheDocument();

    await userEvent.keyboard("{ArrowDown}");
    const reset = await screen.findByRole("button", { name: "Повернути автоматичний" });
    await userEvent.click(reset);

    await waitFor(() =>
      expect(resetCandidateMatch).toHaveBeenCalledWith({ candidateId: "cand-2" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Повернути автоматичний" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("показує історію рішень пари", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Дайджест ↔ Стрічка");

    await userEvent.click(screen.getByRole("button", { name: /Дайджест ↔ Стрічка/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("heading", { name: "Історія рішень" })).toBeInTheDocument();
    expect(within(dialog).getByText("Позначено «не дубль»")).toBeInTheDocument();
    expect(within(dialog).getAllByText("olena").length).toBeGreaterThan(0);
  });

  it("повідомляє про помилку збереження рішення", async () => {
    const { clients, setCandidateMatch } = makeClients();
    setCandidateMatch.mockRejectedValueOnce(new Error("сервіс недоступний"));
    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    const row = rowOf("Новини Первинні ↔ Новини Дзеркало");
    await userEvent.click(within(row).getByRole("radio", { name: "Дубль" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");
  });

  it("дає повторити невдале завантаження", async () => {
    const { clients, listCandidates } = makeClients();
    listCandidates.mockRejectedValueOnce(new Error("сервіс недоступний"));
    renderScreen(clients);

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Новини Первинні ↔ Новини Дзеркало")).toBeInTheDocument();
  });

  it("просить обрати снапшот, поки його не обрано", async () => {
    const { clients, listCandidates } = makeClients();

    renderScreen(clients, "/pairs");

    expect(await screen.findByText("Снапшот не обрано")).toBeInTheDocument();
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it("показує порожній стан, коли кандидатів немає", async () => {
    const { clients, listCandidates } = makeClients();
    listCandidates.mockResolvedValue({ candidates: [], page: {} });

    renderScreen(clients);

    expect(await screen.findByText("Пар немає")).toBeInTheDocument();
  });
});
