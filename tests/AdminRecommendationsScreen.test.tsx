import { Timestamp } from "@bufbuild/protobuf";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";
import { SignalKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";

import type { Clients } from "../src/lib/clients";
import { AdminRecommendationsScreen } from "../src/screens/AdminRecommendationsScreen";

const SNAPSHOT = "11111111-1111-1111-1111-111111111111";
const PRIMARY = "2a000000-0000-4000-8000-000000000001";
const MIRROR = "2b000000-0000-4000-8000-000000000002";
const DIGEST = "2c000000-0000-4000-8000-000000000003";
const WIRE = "2d000000-0000-4000-8000-000000000004";
const UNKNOWN_LEFT = "2e000000-0000-4000-8000-000000000005";
const UNKNOWN_RIGHT = "2f000000-0000-4000-8000-000000000006";

const CREATED_AT = Timestamp.fromDate(new Date("2026-03-01T09:00:00Z"));
const DECIDED_AT = Timestamp.fromDate(new Date("2026-03-02T18:30:00Z"));

function channel(id: string, title: string, username: string) {
  return {
    channel: { id, socialMediaType: SocialMediaType.TELEGRAM, foreignId: id, username, title },
  };
}

function evidence() {
  return {
    matchRate: 0.67,
    earlierChannelId: PRIMARY,
    medianDelaySeconds: 2100,
    leftUniqueShare: 0.33,
    rightUniqueShare: 0.18,
    contentLossRisk: 0.12,
    signals: [
      {
        signal: SignalKind.LEXICAL_OVERLAP,
        value: 0.91,
        sampleSize: 40,
        explanation: "Середня лексична схожість.",
      },
    ],
    samples: [],
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    snapshotId: SNAPSHOT,
    candidateId: "cand-1",
    subjectChannelId: MIRROR,
    referenceChannelId: PRIMARY,
    version: 3n,
    rationale: "«Новини Дзеркало» дублює «Новини Первинні».",
    evidence: evidence(),
    currentDecision: DecisionKind.UNSPECIFIED,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeClients() {
  const listRecommendations = vi.fn().mockResolvedValue({
    recommendations: [
      recommendation(),
      recommendation({
        id: "rec-2",
        candidateId: "cand-2",
        referenceChannelId: DIGEST,
        subjectChannelId: WIRE,
        currentDecision: DecisionKind.CONFIRMED,
        version: 1n,
      }),
      recommendation({
        id: "rec-3",
        candidateId: "cand-3",
        referenceChannelId: UNKNOWN_LEFT,
        subjectChannelId: UNKNOWN_RIGHT,
        currentDecision: DecisionKind.REJECTED,
        version: 1n,
      }),
    ],
    page: {},
  });
  const listDecisions = vi.fn().mockResolvedValue({
    decisions: [
      {
        id: "dec-1",
        recommendationId: "rec-2",
        recommendationVersion: 1n,
        decision: DecisionKind.CONFIRMED,
        decidedAt: DECIDED_AT,
      },
    ],
    page: {},
  });
  const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [{ id: "run-77770000" }], page: {} });

  const clients = {
    recommendation: { listRecommendations, listDecisions },
    duplication: { listAnalysisRuns },
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

  return { clients, listRecommendations, listDecisions };
}

function renderScreen(clients: Clients, entry = `/admin/recommendations?snapshot=${SNAPSHOT}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminRecommendationsScreen clients={clients} />
    </MemoryRouter>,
  );
}

describe("адміністративний огляд рекомендацій", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показує рекомендації снапшоту з парою, ризиком і версією", async () => {
    const { clients } = makeClients();

    renderScreen(clients);

    const cell = await screen.findByText("Новини Первинні ↔ Новини Дзеркало");
    const row = cell.closest("tr") as HTMLElement;
    expect(within(row).getByText("67%")).toBeInTheDocument();
    expect(within(row).getByText("12%")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("Без рішення")).toBeInTheDocument();
    expect(screen.getByText("2e000000… ↔ 2f000000…")).toBeInTheDocument();
  });

  it("називає запуск, з якого згенеровано рекомендації", async () => {
    const { clients } = makeClients();

    renderScreen(clients);

    expect(await screen.findByText(/Запуск #run-7777… · 3 рекомендацій/)).toBeInTheDocument();
  });

  it("підсумовує рішення користувача", async () => {
    const { clients } = makeClients();

    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    const confirmed = screen.getByText("підтверджено").closest("div") as HTMLElement;
    expect(within(confirmed).getByText("1")).toBeInTheDocument();
    const none = screen.getByText("без рішення").closest("div") as HTMLElement;
    expect(within(none).getByText("1")).toBeInTheDocument();
  });

  it("показує дату останнього рішення користувача", async () => {
    const { clients } = makeClients();

    renderScreen(clients);
    await screen.findByText("Новини Первинні ↔ Новини Дзеркало");

    expect(screen.getByText(/02\.03\.26/)).toBeInTheDocument();
  });

  it("просить обрати снапшот, поки його не обрано", async () => {
    const { clients, listRecommendations } = makeClients();

    renderScreen(clients, "/admin/recommendations");

    expect(await screen.findByText("Снапшот не обрано")).toBeInTheDocument();
    expect(listRecommendations).not.toHaveBeenCalled();
  });

  it("показує порожній стан, коли рекомендацій немає", async () => {
    const { clients, listRecommendations } = makeClients();
    listRecommendations.mockResolvedValue({ recommendations: [], page: {} });

    renderScreen(clients);

    expect(await screen.findByText("Рекомендацій немає")).toBeInTheDocument();
  });

  it("дає повторити невдале завантаження", async () => {
    const { clients, listRecommendations } = makeClients();
    listRecommendations.mockRejectedValueOnce(new Error("сервіс недоступний"));

    renderScreen(clients);

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Новини Первинні ↔ Новини Дзеркало")).toBeInTheDocument();
  });
});
