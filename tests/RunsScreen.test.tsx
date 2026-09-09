import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ChannelAddedSource } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";

import type { Clients } from "../src/lib/clients";
import { RunsScreen } from "../src/screens/RunsScreen";

const SNAPSHOT = "11111111-1111-1111-1111-111111111111";
const CHANNEL = "2a000000-0000-4000-8000-000000000001";

function ingestionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "ing-1",
    snapshotId: SNAPSHOT,
    status: RunStatus.SUCCEEDED,
    windowDays: 30,
    channelsTotal: 4,
    channelsProcessed: 4,
    postsIngested: 120,
    channelErrors: [],
    ...overrides,
  };
}

function analysisRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "an-1",
    snapshotId: SNAPSHOT,
    status: RunStatus.SUCCEEDED,
    algorithmVersion: "v1",
    postsAnalyzed: 120,
    pairsCompared: 6,
    candidatesFound: 2,
    channelErrors: [],
    ...overrides,
  };
}

function addedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    channelId: CHANNEL,
    source: ChannelAddedSource.MANUAL,
    appUserId: "user-1",
    appUsername: "admin",
    ...overrides,
  };
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const listIngestionRuns = vi.fn().mockResolvedValue({ runs: [] });
  const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [] });
  const listChannelAddedEvents = vi.fn().mockResolvedValue({ events: [] });

  const clients = {
    ingestion: { listIngestionRuns, ...(overrides.ingestion as object) },
    duplication: { listAnalysisRuns, ...(overrides.duplication as object) },
    catalog: { listChannelAddedEvents, ...(overrides.catalog as object) },
    subscription: { listSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }) },
  } as unknown as Clients;

  return { clients };
}

function renderScreen(clients: Clients, entry = "/runs", pollIntervalMs?: number) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <RunsScreen clients={clients} pollIntervalMs={pollIntervalMs} />
    </MemoryRouter>,
  );
}

describe("екран запусків", () => {
  it("порожня історія має власний стан для обох видів запусків", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(await screen.findByText("Запусків збору поки немає.")).toBeInTheDocument();
    expect(screen.getByText("Запусків аналізу поки немає.")).toBeInTheDocument();
  });

  it("показує обидві історії запусків", async () => {
    const { clients } = makeClients({
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [ingestionRun()] }) },
      duplication: { listAnalysisRuns: vi.fn().mockResolvedValue({ runs: [analysisRun()] }) },
    });
    renderScreen(clients);

    const ingestionHistory = await screen.findByRole("region", { name: "Збір" });
    expect(within(ingestionHistory).getByText("Збір публікацій")).toBeInTheDocument();
    expect(within(ingestionHistory).getByText("4 / 4")).toBeInTheDocument();

    const analysisHistory = screen.getByRole("region", { name: "Аналіз" });
    expect(within(analysisHistory).getByText("Аналіз дублювання")).toBeInTheDocument();
    expect(within(analysisHistory).getByText("кандидатів")).toBeInTheDocument();
    expect(within(analysisHistory).getByText("2")).toBeInTheDocument();
  });

  it("останній запуск показується смугами прогресу з реальних лічильників", async () => {
    const { clients } = makeClients({
      ingestion: {
        listIngestionRuns: vi.fn().mockResolvedValue({
          runs: [
            ingestionRun({ status: RunStatus.RUNNING, channelsTotal: 4, channelsProcessed: 1 }),
          ],
        }),
      },
    });
    renderScreen(clients);

    const collect = await screen.findByRole("progressbar", { name: "Прогрес збору публікацій" });
    expect(collect).toHaveAttribute("aria-valuenow", "25");

    const analysis = screen.getByRole("progressbar", { name: "Прогрес аналізу дублювання" });
    expect(analysis).toHaveAttribute("aria-valuenow", "0");
  });

  it("частковий запуск показує помилку по кожному каналу", async () => {
    const { clients } = makeClients({
      ingestion: {
        listIngestionRuns: vi.fn().mockResolvedValue({
          runs: [
            ingestionRun({
              status: RunStatus.PARTIAL,
              channelsProcessed: 3,
              channelErrors: [
                { channelId: CHANNEL, channelUsername: "private", message: "канал недоступний" },
              ],
            }),
          ],
        }),
      },
    });
    renderScreen(clients);

    const ingestionHistory = await screen.findByRole("region", { name: "Збір" });
    expect(
      within(ingestionHistory).getByText(/Канал private: канал недоступний/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Помилка каналу private: канал недоступний/)).toBeInTheDocument();
  });

  it("журнал подій фільтрується на помилки й дії адміна", async () => {
    const { clients } = makeClients({
      ingestion: {
        listIngestionRuns: vi.fn().mockResolvedValue({
          runs: [
            ingestionRun({
              status: RunStatus.PARTIAL,
              channelErrors: [
                { channelId: CHANNEL, channelUsername: "private", message: "канал недоступний" },
              ],
            }),
          ],
        }),
      },
      catalog: { listChannelAddedEvents: vi.fn().mockResolvedValue({ events: [addedEvent()] }) },
    });
    renderScreen(clients);

    expect(await screen.findByText(/Помилка каналу private/)).toBeInTheDocument();
    expect(screen.getByText(/Додано вручну/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Помилки"));
    expect(screen.getByText(/Помилка каналу private/)).toBeInTheDocument();
    expect(screen.queryByText(/Додано вручну/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Дії адміна"));
    expect(screen.getByText(/Додано вручну/)).toBeInTheDocument();
    expect(screen.queryByText(/Помилка каналу private/)).not.toBeInTheDocument();
  });

  it("без снапшоту в адресі запитує історію всіх снапшотів", async () => {
    const listIngestionRuns = vi.fn().mockResolvedValue({ runs: [] });
    const { clients } = makeClients({ ingestion: { listIngestionRuns } });
    renderScreen(clients);

    await screen.findByText("Запусків збору поки немає.");
    expect(listIngestionRuns).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "" }));
  });

  it("снапшот у адресі звужує обидві історії", async () => {
    const listIngestionRuns = vi.fn().mockResolvedValue({ runs: [] });
    const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [] });
    const { clients } = makeClients({
      ingestion: { listIngestionRuns },
      duplication: { listAnalysisRuns },
    });
    renderScreen(clients, `/runs?snapshot=${SNAPSHOT}`);

    await screen.findByText("Запусків збору поки немає.");
    expect(listIngestionRuns).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: SNAPSHOT }),
    );
    expect(listAnalysisRuns).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: SNAPSHOT }));
  });

  it("без снапшоту запуск недоступний", async () => {
    const { clients } = makeClients({
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [ingestionRun()] }) },
    });
    renderScreen(clients);

    await screen.findByRole("region", { name: "Збір" });
    expect(screen.getByRole("button", { name: "Новий запуск" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Запустити аналіз" })).toBeDisabled();
  });

  it("зі снапшотом окремий аналіз доступний", async () => {
    const { clients } = makeClients({
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [ingestionRun()] }) },
    });
    renderScreen(clients, `/runs?snapshot=${SNAPSHOT}`);

    await screen.findByRole("region", { name: "Збір" });
    expect(screen.getByRole("button", { name: "Новий запуск" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Запустити аналіз" })).toBeEnabled();
  });

  it("одним запуском стартує збір і одразу ставить аналіз у чергу за ним", async () => {
    const startIngestion = vi
      .fn()
      .mockResolvedValue({ run: ingestionRun({ status: RunStatus.RUNNING, channelsProcessed: 0 }) });
    const getIngestionRun = vi
      .fn()
      .mockResolvedValue({ run: ingestionRun({ status: RunStatus.RUNNING }) });
    const startAnalysis = vi.fn().mockResolvedValue({
      run: analysisRun({ status: RunStatus.PENDING, awaitedIngestionRunId: "ing-1" }),
    });
    const getAnalysisRun = vi.fn().mockResolvedValue({
      run: analysisRun({ status: RunStatus.PENDING, awaitedIngestionRunId: "ing-1" }),
    });

    const { clients } = makeClients({
      ingestion: { startIngestion, getIngestionRun },
      duplication: { startAnalysis, getAnalysisRun },
    });
    renderScreen(clients, `/runs?snapshot=${SNAPSHOT}`, 5);
    await screen.findByText("Запусків збору поки немає.");

    await userEvent.click(screen.getByRole("button", { name: "Новий запуск" }));

    await waitFor(() =>
      expect(startIngestion).toHaveBeenCalledWith({ snapshotId: SNAPSHOT, windowDays: 30 }),
    );
    await waitFor(() =>
      expect(startAnalysis).toHaveBeenCalledWith({
        snapshotId: SNAPSHOT,
        afterIngestionRunId: "ing-1",
      }),
    );
    await waitFor(() => expect(getIngestionRun).toHaveBeenCalledWith({ runId: "ing-1" }));
    await waitFor(() => expect(getAnalysisRun).toHaveBeenCalledWith({ runId: "an-1" }));
  });

  it("запуск у черзі можна скасувати, а той, що виконується, — ні", async () => {
    const startAnalysis = vi
      .fn()
      .mockResolvedValue({ run: analysisRun({ status: RunStatus.PENDING, queuePosition: 0 }) });
    const getAnalysisRun = vi
      .fn()
      .mockResolvedValue({ run: analysisRun({ status: RunStatus.PENDING, queuePosition: 0 }) });
    const cancelAnalysisRun = vi
      .fn()
      .mockResolvedValue({ run: analysisRun({ status: RunStatus.CANCELLED }) });

    const { clients } = makeClients({
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [ingestionRun()] }) },
      duplication: { startAnalysis, getAnalysisRun, cancelAnalysisRun },
    });
    renderScreen(clients, `/runs?snapshot=${SNAPSHOT}`, 10_000);
    await screen.findByRole("region", { name: "Збір" });

    await userEvent.click(screen.getByRole("button", { name: "Запустити аналіз" }));

    const cancel = await screen.findByRole("button", { name: "Скасувати" });
    await userEvent.click(cancel);

    await waitFor(() => expect(cancelAnalysisRun).toHaveBeenCalledWith({ runId: "an-1" }));
    expect(await screen.findByText("Скасовано")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Скасувати" })).not.toBeInTheDocument();
  });

  it("запуск, що виконується, не пропонує скасування", async () => {
    const startAnalysis = vi
      .fn()
      .mockResolvedValue({ run: analysisRun({ status: RunStatus.RUNNING }) });

    const { clients } = makeClients({
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [ingestionRun()] }) },
      duplication: {
        startAnalysis,
        getAnalysisRun: vi.fn().mockResolvedValue({ run: analysisRun({ status: RunStatus.RUNNING }) }),
      },
    });
    renderScreen(clients, `/runs?snapshot=${SNAPSHOT}`, 10_000);
    await screen.findByRole("region", { name: "Збір" });

    await userEvent.click(screen.getByRole("button", { name: "Запустити аналіз" }));

    await waitFor(() => expect(startAnalysis).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Скасувати" })).not.toBeInTheDocument();
  });

  it("помилку завантаження історії можна повторити", async () => {
    const listIngestionRuns = vi
      .fn()
      .mockRejectedValueOnce(new Error("мережа"))
      .mockResolvedValue({ runs: [] });
    const { clients } = makeClients({ ingestion: { listIngestionRuns } });
    renderScreen(clients);

    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    await screen.findByText("Запусків збору поки немає.");
    expect(listIngestionRuns).toHaveBeenCalledTimes(2);
  });
});
