import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignalKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";

import type { Clients } from "../src/lib/clients";
import { RecommendationsScreen } from "../src/screens/RecommendationsScreen";

const SNAPSHOT = "snap-1";
const PRIMARY = "2a000000-0000-4000-8000-000000000001";
const MIRROR = "2b000000-0000-4000-8000-000000000002";

function evidence() {
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
    ],
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    snapshotId: SNAPSHOT,
    candidateId: "cand-1",
    subjectChannelId: MIRROR,
    referenceChannelId: PRIMARY,
    version: 1n,
    rationale: "«Новини Дзеркало» дублює «Новини Первинні».",
    evidence: evidence(),
    currentDecision: DecisionKind.UNSPECIFIED,
    createdAt: undefined,
    ...overrides,
  };
}

function snapshotMembers() {
  return [
    { channelId: PRIMARY, title: "Новини Первинні", username: "pervynni" },
    { channelId: MIRROR, title: "Новини Дзеркало", username: "dzerkalo" },
  ];
}

function makeClients(overrides: Partial<Record<string, unknown>> = {}) {
  const listRecommendations = vi.fn().mockResolvedValue({ recommendations: [recommendation()] });
  const submitDecision = vi.fn().mockImplementation(async (request: { decision: DecisionKind }) => ({
    decision: {
      id: "dec-1",
      recommendationId: "rec-1",
      recommendationVersion: 1n,
      decision: request.decision,
      decidedAt: undefined,
    },
    recommendation: recommendation({ currentDecision: request.decision }),
  }));
  const listDecisions = vi.fn().mockResolvedValue({ decisions: [] });
  const getSnapshot = vi
    .fn()
    .mockResolvedValue({ snapshot: { id: SNAPSHOT }, members: snapshotMembers() });

  return {
    clients: {
      recommendation: { listRecommendations, submitDecision, listDecisions },
      subscription: { getSnapshot },
      ...overrides,
    } as unknown as Clients,
    listRecommendations,
    submitDecision,
    listDecisions,
    getSnapshot,
  };
}

function tab(name: string) {
  return screen.getByText(name);
}

describe("екран рекомендацій", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показує рекомендацію з поясненням", async () => {
    const { clients } = makeClients();

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText(/дублює/)).toBeInTheDocument();
  });

  it("називає канал, який пропонується зняти, і той, що лишається", async () => {
    const { clients } = makeClients();

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText("Зняти @dzerkalo")).toBeInTheDocument();
    expect(await screen.findByText("Лишається @pervynni")).toBeInTheDocument();
  });

  it("тримає докази згорнутими, доки їх не розкриють", async () => {
    const { clients } = makeClients();

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    expect(screen.queryByRole("heading", { name: "Сигнали" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Докази та втрати" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("розкриває сигнали роздільно, а не одним числом", async () => {
    const { clients } = makeClients();
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: "Докази та втрати" }));

    expect(screen.getByRole("heading", { name: "Сигнали" })).toBeInTheDocument();
    expect(screen.getByText("Лексичний збіг 91%")).toBeInTheDocument();
    expect(screen.getByText("Спільні домени 75%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("показує частку унікального й ризик втрати контенту", async () => {
    const { clients } = makeClients();
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: "Докази та втрати" }));

    const risk = screen.getByText("Ризик втрати").closest("div");
    expect(within(risk as HTMLElement).getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("Унікальне зліва")).toBeInTheDocument();
  });

  it("показує приклади збігів із посиланням на конкретні публікації", async () => {
    const { clients } = makeClients();
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: "Докази та втрати" }));

    expect(screen.getByText(/Канал 2a000000…, допис 1000/)).toBeInTheDocument();
    expect(screen.getByText(/Канал 2b000000…, допис 2000/)).toBeInTheDocument();
  });

  it("попереджає про втрату лише за високого ризику", async () => {
    const warning = /Ризик втрати вищий за середній/;
    const { clients } = makeClients();
    const { unmount } = render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    unmount();

    const risky = makeClients();
    risky.listRecommendations.mockResolvedValue({
      recommendations: [recommendation({ evidence: { ...evidence(), contentLossRisk: 0.42 } })],
    });
    render(<RecommendationsScreen clients={risky.clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText(warning)).toBeInTheDocument();
  });

  it.each([
    ["Підтвердити", DecisionKind.CONFIRMED],
    ["Відхилити", DecisionKind.REJECTED],
    ["Відкласти", DecisionKind.DEFERRED],
  ])("надсилає рішення «%s» разом із версією рекомендації", async (label, expected) => {
    const { clients, submitDecision } = makeClients();
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() =>
      expect(submitDecision).toHaveBeenCalledWith({
        recommendationId: "rec-1",
        recommendationVersion: 1n,
        decision: expected,
      }),
    );
  });

  it("переносить ухвалену рекомендацію у «Виконані» після відповіді сервера", async () => {
    const { clients } = makeClients();
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: "Підтвердити" }));

    expect(await screen.findByRole("radio", { name: "Виконані 1" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Активні 0" })).toBeInTheDocument();
    expect(screen.getByText("Тут поки порожньо")).toBeInTheDocument();

    await userEvent.click(tab("Виконані 1"));

    expect(screen.getByText("Підтверджено")).toBeInTheDocument();
    expect(screen.getByText("Зняти @dzerkalo")).toBeInTheDocument();
  });

  it("повертає ухвалену рекомендацію в активні як відкладену", async () => {
    const { clients, listRecommendations, submitDecision } = makeClients();
    listRecommendations.mockResolvedValue({
      recommendations: [recommendation({ currentDecision: DecisionKind.CONFIRMED })],
    });
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByRole("radio", { name: "Виконані 1" });

    await userEvent.click(tab("Виконані 1"));
    await userEvent.click(screen.getByRole("button", { name: "Повернути" }));

    await waitFor(() =>
      expect(submitDecision).toHaveBeenCalledWith({
        recommendationId: "rec-1",
        recommendationVersion: 1n,
        decision: DecisionKind.DEFERRED,
      }),
    );
    expect(await screen.findByRole("radio", { name: "Активні 1" })).toBeInTheDocument();
  });

  it("лишає відкладену рекомендацію серед активних", async () => {
    const { clients, listRecommendations } = makeClients();
    listRecommendations.mockResolvedValue({
      recommendations: [recommendation({ currentDecision: DecisionKind.DEFERRED })],
    });

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByRole("radio", { name: "Активні 1" })).toBeInTheDocument();
    expect(screen.getByText("Відкладено")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Підтвердити" })).toBeInTheDocument();
  });

  it("показує час ухвалення поруч із рішенням", async () => {
    const { clients, listRecommendations, listDecisions } = makeClients();
    listRecommendations.mockResolvedValue({
      recommendations: [recommendation({ currentDecision: DecisionKind.REJECTED })],
    });
    listDecisions.mockResolvedValue({
      decisions: [
        {
          id: "dec-1",
          recommendationId: "rec-1",
          recommendationVersion: 1n,
          decision: DecisionKind.REJECTED,
          decidedAt: { toDate: () => new Date("2026-08-11T10:30:00Z") },
        },
      ],
    });

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    await userEvent.click(await screen.findByText("Відхилені 1"));

    expect(screen.getByText(/^Відхилено · /)).toBeInTheDocument();
  });

  it("повідомляє, що відписка виконується вручну", async () => {
    const { clients } = makeClients();

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText(/вручну в Telegram/)).toBeInTheDocument();
  });

  it("показує помилку, якщо рішення не збереглося", async () => {
    const { clients, submitDecision } = makeClients();
    submitDecision.mockRejectedValueOnce(new Error("сервіс недоступний"));
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);
    await screen.findByText(/дублює/);

    await userEvent.click(screen.getByRole("button", { name: "Підтвердити" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");
  });

  it("дає повторити запит, якщо перелік не завантажився", async () => {
    const { clients, listRecommendations } = makeClients();
    listRecommendations.mockRejectedValueOnce(new Error("сервіс недоступний"));
    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText(/дублює/)).toBeInTheDocument();
  });

  it("показує порожній стан, коли рекомендацій немає", async () => {
    const { clients, listRecommendations } = makeClients();
    listRecommendations.mockResolvedValue({ recommendations: [] });

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText("Тут поки порожньо")).toBeInTheDocument();
    expect(
      screen.getByText("Активних рекомендацій за цим снапшотом немає."),
    ).toBeInTheDocument();
  });

  it("лишається придатним, коли склад снапшоту недоступний", async () => {
    const { clients, getSnapshot } = makeClients();
    getSnapshot.mockRejectedValue(new Error("недоступно"));

    render(<RecommendationsScreen clients={clients} snapshotId={SNAPSHOT} />);

    expect(await screen.findByText("Зняти 2b000000…")).toBeInTheDocument();
  });
});
