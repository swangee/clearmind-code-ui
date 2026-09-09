import { Timestamp } from "@bufbuild/protobuf";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  RunFailureCode,
  RunStatus,
  SocialMediaType,
} from "@clearmind/contracts/clearmind/v1/common_pb";
import { AnalysisStage } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { ChannelIngestionState } from "@clearmind/contracts/clearmind/v1/ingestion_pb";
import {
  SubscriptionKind,
  SubscriptionVisibility,
} from "@clearmind/contracts/clearmind/v1/subscription_pb";

import type { Clients } from "../src/lib/clients";
import { ImportScreen } from "../src/screens/ImportScreen";

const PRIMARY = "3a000000-0000-4000-8000-000000000001";
const ANALYTICS = "3a000000-0000-4000-8000-000000000002";

const PRIVATE_CHAT_TITLE = "Іван Петренко";

function subscriptions() {
  return [
    {
      channelId: PRIMARY,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "300000001",
      title: "Новини Первинні",
      username: "primary",
      kind: SubscriptionKind.CHANNEL,
      visibility: SubscriptionVisibility.PUBLIC,
      isImportable: true,
    },
    {
      channelId: ANALYTICS,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "300000002",
      title: "Аналітика Дня",
      username: "analytics",
      kind: SubscriptionKind.CHANNEL,
      visibility: SubscriptionVisibility.PUBLIC,
      isImportable: true,
    },
    {
      channelId: "",
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "300000003",
      title: "Чат спільноти",
      username: "community",
      kind: SubscriptionKind.GROUP,
      visibility: SubscriptionVisibility.PUBLIC,
      isImportable: false,
    },
    {
      channelId: "",
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "300000004",
      title: PRIVATE_CHAT_TITLE,
      username: "",
      kind: SubscriptionKind.UNSPECIFIED,
      visibility: SubscriptionVisibility.PRIVATE,
      isImportable: false,
    },
  ];
}

const RUN_ID = "run-1";
const ANALYSIS_RUN_ID = "arun-1";

function channelProgress(over: Record<string, unknown> = {}) {
  return {
    channelId: PRIMARY,
    username: "primary",
    title: "Новини Первинні",
    state: ChannelIngestionState.QUEUED,
    postsIngested: 0,
    previouslyCollected: false,
    ...over,
  };
}

function ingestionRun(over: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    snapshotId: "snap-1",
    status: RunStatus.RUNNING,
    windowDays: 30,
    channelsTotal: 2,
    channelsProcessed: 0,
    postsIngested: 0,
    rateLimitWaits: 0,
    channelErrors: [],
    channels: [],
    ...over,
  };
}

function analysisRun(over: Record<string, unknown> = {}) {
  return {
    id: ANALYSIS_RUN_ID,
    snapshotId: "snap-1",
    status: RunStatus.RUNNING,
    postsAnalyzed: 0,
    pairsCompared: 0,
    candidatesFound: 0,
    channelErrors: [],
    stages: [],
    currentStage: AnalysisStage.UNSPECIFIED,
    ...over,
  };
}

function finishedAnalysis(over: Record<string, unknown> = {}) {
  return analysisRun({
    status: RunStatus.SUCCEEDED,
    postsAnalyzed: 980,
    pairsCompared: 1,
    candidatesFound: 1,
    stages: [
      { stage: AnalysisStage.LOADING_POSTS, doneUnits: 980, totalUnits: 980 },
      { stage: AnalysisStage.SIGNATURES, doneUnits: 980, totalUnits: 980 },
      { stage: AnalysisStage.PAIR_COMPARISON, doneUnits: 1, totalUnits: 1 },
      { stage: AnalysisStage.RECOMMENDATIONS, doneUnits: 3, totalUnits: 3 },
    ],
    currentStage: AnalysisStage.RECOMMENDATIONS,
    ...over,
  });
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const importSubscriptions = vi
    .fn()
    .mockResolvedValue({ subscriptions: subscriptions(), importableCount: 2 });
  const createSnapshot = vi.fn().mockResolvedValue({
    snapshot: { id: "snap-1", version: 4n, memberCount: 2 },
  });
  const listSnapshots = vi.fn().mockResolvedValue({ snapshots: [] });

  const startIngestion = vi.fn().mockResolvedValue({ run: ingestionRun() });
  const getIngestionRun = vi
    .fn()
    .mockResolvedValue({ run: ingestionRun({ status: RunStatus.SUCCEEDED }) });
  const listIngestionRuns = vi.fn().mockResolvedValue({ runs: [] });

  const startAnalysis = vi.fn().mockResolvedValue({ run: analysisRun() });
  const getAnalysisRun = vi.fn().mockResolvedValue({ run: finishedAnalysis() });
  const listAnalysisRuns = vi.fn().mockResolvedValue({ runs: [] });

  const clients = {
    subscription: {
      importSubscriptions,
      createSnapshot,
      listSnapshots,
      ...(overrides.subscription as object),
    },
    ingestion: {
      startIngestion,
      getIngestionRun,
      listIngestionRuns,
      ...(overrides.ingestion as object),
    },
    duplication: {
      startAnalysis,
      getAnalysisRun,
      listAnalysisRuns,
      ...(overrides.duplication as object),
    },
  } as unknown as Clients;

  return {
    clients,
    importSubscriptions,
    createSnapshot,
    listSnapshots,
    startIngestion,
    getIngestionRun,
    listIngestionRuns,
    startAnalysis,
    getAnalysisRun,
    listAnalysisRuns,
  };
}

function renderScreen(clients: Clients) {
  return render(
    <MemoryRouter>
      <ImportScreen clients={clients} pollIntervalMs={5} />
    </MemoryRouter>,
  );
}

const EXPORT_JSON = JSON.stringify({
  chats: {
    list: [{ name: "Новини Первинні", type: "public_channel", id: 300000001 }],
  },
});

const FILE_FIELD = "Файл експорту Telegram Desktop Lite (result.json)";

function exportFile(content = EXPORT_JSON, name = "result.json") {
  return new File([content], name, { type: "application/json" });
}

async function uploadExport(clients: Clients, file = exportFile()) {
  renderScreen(clients);
  await userEvent.upload(screen.getByLabelText(FILE_FIELD), file);
  await screen.findByText("Новини Первинні");
}

async function readDialogs(clients: Clients) {
  renderScreen(clients);
  await userEvent.click(
    screen.getByRole("button", { name: "Зчитати діалоги" }),
  );
  await screen.findByText("Новини Первинні");
}

function row(name: string) {
  return (screen.getByText(name).closest("tr") ?? document.body) as HTMLElement;
}

function labelled(label: string) {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

describe("екран імпорту підписок", () => {
  it("починає з кроку вибору файлу й не звертається до контракту сам", () => {
    const { clients, importSubscriptions } = makeClients();
    renderScreen(clients);

    expect(
      screen.getByRole("button", { name: "Обрати файл" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(FILE_FIELD)).toBeInTheDocument();
    expect(importSubscriptions).not.toHaveBeenCalled();
  });

  it("називає джерелом експорт Telegram Desktop Lite і шлях до нього", () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(screen.getAllByText(/Telegram Desktop Lite/).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(
        /Налаштування → Додаткові → Експорт даних → Список чатів/,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("надсилає байти обраного файлу полем контракту", async () => {
    const { clients, importSubscriptions } = makeClients();
    await uploadExport(clients);

    expect(importSubscriptions).toHaveBeenCalledTimes(1);
    const [request] = importSubscriptions.mock.calls[0] as [
      { exportFile?: Uint8Array },
    ];
    expect(request.exportFile).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(request.exportFile)).toBe(EXPORT_JSON);
  });

  it("підсумок файлу показує його справжню назву й розмір", async () => {
    const { clients } = makeClients();
    const file = exportFile("x".repeat(3_400_000), "telegram-export.json");
    await uploadExport(clients, file);

    expect(screen.getByText("telegram-export.json")).toBeInTheDocument();
    expect(
      screen.getByText(/3,2 МБ · 4 діалогів у переліку/),
    ).toBeInTheDocument();
  });

  it("«Замінити файл» повертає на крок вибору файлу", async () => {
    const { clients } = makeClients();
    await uploadExport(clients);

    await userEvent.click(
      screen.getByRole("button", { name: "Замінити файл" }),
    );

    expect(
      screen.getByRole("button", { name: "Обрати файл" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Новини Первинні")).not.toBeInTheDocument();
  });

  it("читання з акаунта лишається доступним, коли файл не обрано", async () => {
    const { clients, importSubscriptions } = makeClients();
    await readDialogs(clients);

    expect(importSubscriptions).toHaveBeenCalledWith({});
    expect(
      screen.getByRole("button", { name: "Зчитати заново" }),
    ).toBeInTheDocument();
  });

  it("повторює саме читання файлу після помилки розбору", async () => {
    const importSubscriptions = vi
      .fn()
      .mockRejectedValueOnce(
        new ConnectError(
          "Не вдалося розібрати файл експорту.",
          Code.InvalidArgument,
        ),
      )
      .mockResolvedValue({
        subscriptions: subscriptions(),
        importableCount: 2,
      });
    const { clients } = makeClients({ subscription: { importSubscriptions } });
    renderScreen(clients);

    await userEvent.upload(screen.getByLabelText(FILE_FIELD), exportFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не вдалося розібрати файл експорту.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Новини Первинні")).toBeInTheDocument();
    expect(importSubscriptions).toHaveBeenCalledTimes(2);
    const [second] = importSubscriptions.mock.calls[1] as [
      { exportFile?: Uint8Array },
    ];
    expect(second.exportFile).toBeInstanceOf(Uint8Array);
  });

  it("приватний діалог без назви та ідентифікатора лишається окремим рядком", async () => {
    const anonymous = {
      channelId: "",
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "",
      title: "",
      username: "",
      kind: SubscriptionKind.UNSPECIFIED,
      visibility: SubscriptionVisibility.PRIVATE,
      isImportable: false,
    };
    const { clients } = makeClients({
      subscription: {
        importSubscriptions: vi.fn().mockResolvedValue({
          subscriptions: [subscriptions()[0], anonymous, anonymous],
          importableCount: 1,
        }),
      },
    });
    await uploadExport(clients);

    expect(screen.getAllByText("Приватний діалог")).toHaveLength(2);
    expect(
      screen.getByText(/1 із 3 діалогів · 2 пропущено/),
    ).toBeInTheDocument();
  });

  it("розділяє розпізнані канали й пропущені діалоги", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    expect(
      within(row("Новини Первинні")).getByText("Розпізнано"),
    ).toBeInTheDocument();
    expect(
      within(row("Чат спільноти")).getByText("Пропущено"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 із 4 діалогів · 2 пропущено/),
    ).toBeInTheDocument();
  });

  it("пропущений приватний діалог показано лише типом, без назви та ідентифікатора", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    expect(screen.queryByText(PRIVATE_CHAT_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText("300000004")).not.toBeInTheDocument();
    const masked = row("Приватний діалог");
    expect(within(masked).getByText("Пропущено")).toBeInTheDocument();
    expect(within(masked).getByText("Інший діалог")).toBeInTheDocument();
    expect(within(masked).getByText("—")).toBeInTheDocument();
  });

  it("пропущений рядок не має позначки для вибору", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    expect(
      within(row("Чат спільноти")).queryByRole("checkbox"),
    ).not.toBeInTheDocument();
  });

  it("подання «Пропущені» лишає в таблиці лише пропущені діалоги", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    await userEvent.click(screen.getByRole("radio", { name: /^Пропущені/ }));

    expect(screen.queryByText("Новини Первинні")).not.toBeInTheDocument();
    expect(screen.getByText("Чат спільноти")).toBeInTheDocument();
  });

  it("знята позначка рядка зменшує лічильник і не потрапляє до підтвердження", async () => {
    const { clients, createSnapshot } = makeClients();
    await readDialogs(clients);

    expect(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Імпортувати «Аналітика Дня»" }),
    );

    const confirm = screen.getByRole("button", { name: /Підтвердити 1 канал/ });
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(createSnapshot).toHaveBeenCalledWith({
        memberChannelIds: [PRIMARY],
      }),
    );
  });

  it("вимкнення типу знімає позначки з усіх рядків цього типу", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    await userEvent.click(screen.getByRole("checkbox", { name: /^Канали/ }));

    expect(
      screen.getByRole("checkbox", { name: "Імпортувати «Новини Первинні»" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Імпортувати «Аналітика Дня»" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /Підтвердити 0 канал/ }),
    ).toBeDisabled();
  });

  it("повторне ввімкнення типу повертає позначки всім його рядкам", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    const type = screen.getByRole("checkbox", { name: /^Канали/ });
    await userEvent.click(type);
    await userEvent.click(type);

    expect(
      screen.getByRole("checkbox", { name: "Імпортувати «Новини Первинні»" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    ).toBeInTheDocument();
  });

  it("тип, у якому немає придатних каналів, не можна ввімкнути", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    expect(screen.getByRole("checkbox", { name: /^Групи/ })).toBeDisabled();
  });

  it("підтвердження надсилає лише позначені канали, без пропущених діалогів", async () => {
    const { clients, createSnapshot } = makeClients();
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    await waitFor(() =>
      expect(createSnapshot).toHaveBeenCalledWith({
        memberChannelIds: [PRIMARY, ANALYTICS],
      }),
    );
  });

  it("підтвердження запускає збір і веде на крок обробки", async () => {
    const startIngestion = vi.fn().mockResolvedValue({ run: ingestionRun() });
    const { clients } = makeClients({
      ingestion: {
        startIngestion,
        getIngestionRun: vi.fn().mockResolvedValue({ run: ingestionRun() }),
        listIngestionRuns: vi.fn().mockResolvedValue({ runs: [] }),
      },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(await screen.findByText("Збір публікацій")).toBeInTheDocument();
    expect(screen.getByText("Аналіз дублів")).toBeInTheDocument();
    expect(startIngestion).toHaveBeenCalledWith({
      snapshotId: "snap-1",
      windowDays: 0,
    });
  });

  it("аналіз стає в чергу за збором, не чекаючи його завершення", async () => {
    const startAnalysis = vi.fn().mockResolvedValue({
      run: analysisRun({
        status: RunStatus.PENDING,
        awaitedIngestionRunId: RUN_ID,
      }),
    });
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({ status: RunStatus.RUNNING }),
        }),
      },
      duplication: { startAnalysis },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    await waitFor(() =>
      expect(startAnalysis).toHaveBeenCalledWith({
        snapshotId: "snap-1",
        afterIngestionRunId: RUN_ID,
      }),
    );
  });

  it("три стани аналізу до появи етапів різняться між собою", async () => {
    const states = [
      {
        run: analysisRun({
          status: RunStatus.PENDING,
          awaitedIngestionRunId: RUN_ID,
        }),
        label: "Очікує завершення збору",
      },
      {
        run: analysisRun({ status: RunStatus.PENDING, queuePosition: 2 }),
        label: "У черзі — попереду 2",
      },
      {
        run: analysisRun({ status: RunStatus.PENDING, queuePosition: 0 }),
        label: "У черзі — наступний",
      },
      { run: analysisRun({ status: RunStatus.RUNNING }), label: "Виконується" },
    ];

    for (const state of states) {
      const { clients } = makeClients({
        ingestion: {
          getIngestionRun: vi.fn().mockResolvedValue({
            run: ingestionRun({ status: RunStatus.RUNNING }),
          }),
        },
        duplication: {
          startAnalysis: vi.fn().mockResolvedValue({ run: state.run }),
          getAnalysisRun: vi.fn().mockResolvedValue({ run: state.run }),
        },
      });
      await readDialogs(clients);
      await userEvent.click(
        screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
      );

      const card = await screen.findByRole("region", { name: "Аналіз дублів" });
      expect(await within(card).findByText(state.label)).toBeInTheDocument();
      cleanup();
    }
  });

  it("запуск у черзі можна скасувати, і скасований не подається помилкою", async () => {
    let cancelled = false;
    const cancelAnalysisRun = vi.fn().mockImplementation(async () => {
      cancelled = true;
      return { run: analysisRun({ status: RunStatus.CANCELLED }) };
    });
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({ status: RunStatus.RUNNING }),
        }),
      },
      duplication: {
        startAnalysis: vi.fn().mockResolvedValue({
          run: analysisRun({ status: RunStatus.PENDING, queuePosition: 0 }),
        }),
        getAnalysisRun: vi.fn().mockImplementation(async () => ({
          run: cancelled
            ? analysisRun({ status: RunStatus.CANCELLED })
            : analysisRun({ status: RunStatus.PENDING, queuePosition: 0 }),
        })),
        cancelAnalysisRun,
      },
    });
    await readDialogs(clients);
    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Скасувати" }),
    );

    await waitFor(() =>
      expect(cancelAnalysisRun).toHaveBeenCalledWith({ runId: ANALYSIS_RUN_ID }),
    );
    const card = await screen.findByRole("region", { name: "Аналіз дублів" });
    expect(within(card).getByText("Скасовано")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Запустити аналіз" }),
    ).toBeInTheDocument();
  });

  it("поступ рухається між опитуваннями", async () => {
    let collected = false;
    const getIngestionRun = vi.fn().mockImplementation(async () => ({
      run: collected
        ? ingestionRun({
            status: RunStatus.SUCCEEDED,
            channelsProcessed: 2,
            postsIngested: 980,
          })
        : ingestionRun({ postsIngested: 120 }),
    }));
    const { clients } = makeClients({ ingestion: { getIngestionRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(await screen.findByText("120")).toBeInTheDocument();

    collected = true;
    expect(await screen.findByText("980")).toBeInTheDocument();
  });

  it("канал у черзі показує прочерк, а не нуль зібраних публікацій", async () => {
    const getIngestionRun = vi.fn().mockResolvedValue({
      run: ingestionRun({ channels: [channelProgress()] }),
    });
    const { clients } = makeClients({ ingestion: { getIngestionRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    const line = await screen.findByText("Очікує своєї черги");
    const cells = within(line.closest("tr") as HTMLElement).getAllByRole(
      "cell",
    );
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[3]).not.toHaveTextContent("0");
  });

  it("канал зі снапшоту називає час збору, який перевикористано", async () => {
    const getIngestionRun = vi.fn().mockResolvedValue({
      run: ingestionRun({
        channels: [
          channelProgress({
            state: ChannelIngestionState.REUSED,
            postsIngested: 412,
            previouslyCollected: true,
            collectedAt: Timestamp.fromDate(new Date("2026-08-13T09:20:00Z")),
          }),
        ],
      }),
    });
    const { clients } = makeClients({ ingestion: { getIngestionRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(await screen.findByText(/Збір від/)).toBeInTheDocument();
    expect(screen.getByText("З каталогу")).toBeInTheDocument();
    expect(screen.getByText("Зі снапшоту")).toBeInTheDocument();
  });

  it("канал під лімітом називає залишок очікування", async () => {
    const getIngestionRun = vi.fn().mockResolvedValue({
      run: ingestionRun({
        channels: [
          channelProgress({
            state: ChannelIngestionState.RATE_LIMITED,
            retryAfterSeconds: 30,
          }),
        ],
        rateLimitWaits: 1,
      }),
    });
    const { clients } = makeClients({ ingestion: { getIngestionRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(
      await screen.findByText("Ліміт запитів — повтор за 30 с"),
    ).toBeInTheDocument();
  });

  it("канал із помилкою видно, і решта рядків лишається", async () => {
    const getIngestionRun = vi.fn().mockResolvedValue({
      run: ingestionRun({
        status: RunStatus.PARTIAL,
        channels: [
          channelProgress({ state: ChannelIngestionState.FAILED }),
          channelProgress({
            channelId: ANALYTICS,
            username: "analytics",
            title: "Аналітика Дня",
            state: ChannelIngestionState.DONE,
            postsIngested: 512,
          }),
        ],
      }),
    });
    const { clients } = makeClients({ ingestion: { getIngestionRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(
      await screen.findByText("Історію прочитати не вдалося"),
    ).toBeInTheDocument();
    expect(screen.getByText("Історію прочитано повністю")).toBeInTheDocument();
  });

  it("етап без порахованого загалу не показує нуль", async () => {
    const getAnalysisRun = vi.fn().mockResolvedValue({
      run: analysisRun({
        stages: [
          {
            stage: AnalysisStage.LOADING_POSTS,
            doneUnits: 300,
            totalUnits: 980,
          },
          { stage: AnalysisStage.PAIR_COMPARISON, doneUnits: 0 },
        ],
      }),
    });
    const { clients } = makeClients({ duplication: { getAnalysisRun } });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    const stage = await screen.findByRole("listitem", {
      name: "Порівняння пар каналів",
    });
    expect(stage).toHaveTextContent("—");
    expect(stage).not.toHaveTextContent("0 із 0");
  });

  function brokenPipeline(
    failure: Record<string, unknown> = {
      code: RunFailureCode.ACCOUNT_NOT_CONNECTED,
      message: "Акаунт Telegram не підключено.",
    },
  ) {
    return {
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({
            status: RunStatus.FAILED,
            channelsProcessed: 0,
            postsIngested: 0,
            failure,
          }),
        }),
      },
      duplication: {
        getAnalysisRun: vi.fn().mockResolvedValue({
          run: analysisRun({
            status: RunStatus.FAILED,
            failure: {
              code: RunFailureCode.COLLECTION_UNUSABLE,
              message: "Збір не дав жодної публікації.",
            },
          }),
        }),
      },
    };
  }

  async function processBroken(overrides = brokenPipeline()) {
    const { clients } = makeClients(overrides);
    await readDialogs(clients);
    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );
    return clients;
  }

  it("провалений збір показується провалом, а не завершеною роботою", async () => {
    await processBroken();

    const card = await screen.findByRole("region", { name: "Збір публікацій" });
    expect(await within(card).findByText("Помилка")).toBeInTheDocument();
    expect(within(card).queryByText("Завершено")).not.toBeInTheDocument();
    expect(
      within(card).getByText(/Акаунт Telegram не підключено/),
    ).toBeInTheDocument();
  });

  it("частковий збір відрізняється від успішного", async () => {
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({
            status: RunStatus.PARTIAL,
            channelsProcessed: 1,
            postsIngested: 512,
          }),
        }),
      },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    const card = await screen.findByRole("region", { name: "Збір публікацій" });
    expect(
      await within(card).findByText("Завершено частково"),
    ).toBeInTheDocument();
    expect(within(card).queryByText("Завершено")).not.toBeInTheDocument();
  });

  it("шапка не звітує про завершену обробку й називає етап, що впав", async () => {
    await processBroken();

    expect(await screen.findByText("Обробку не завершено")).toBeInTheDocument();
    expect(
      screen.getByText("Не вдався етап «Збір публікацій»"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Обробку завершено")).not.toBeInTheDocument();
  });

  it("причина провалу аналізу стоїть біля аналізу", async () => {
    await processBroken();

    const card = await screen.findByRole("region", { name: "Аналіз дублів" });
    expect(
      await within(card).findByText(/Збір не дав жодної публікації/),
    ).toBeInTheDocument();
  });

  it("першою дією над провалом стоїть те, що адресує сам провал", async () => {
    await processBroken();

    const remedy = await screen.findByRole("link", {
      name: /Підключити акаунт Telegram/,
    });
    expect(remedy).toHaveAttribute("href", "/account");
    expect(remedy).toHaveClass("btn-primary");
    expect(screen.getByRole("link", { name: /ревізію/ })).toHaveClass(
      "btn-secondary",
    );
    expect(
      screen.queryByRole("button", { name: "Підсумок імпорту" }),
    ).not.toBeInTheDocument();
  });

  it("провал через платформу пропонує повторити збір", async () => {
    const startIngestion = vi.fn().mockResolvedValue({ run: ingestionRun() });
    const unavailable = brokenPipeline({
      code: RunFailureCode.PLATFORM_UNAVAILABLE,
      message: "Telegram не відповів.",
    });
    const { clients } = makeClients({
      ...unavailable,
      ingestion: { ...unavailable.ingestion, startIngestion },
    });
    await readDialogs(clients);
    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    const retry = await screen.findByRole("button", {
      name: "Повторити збір",
    });
    await userEvent.click(retry);

    await waitFor(() => expect(startIngestion).toHaveBeenCalledTimes(2));
  });

  it("успішна обробка звітує про завершення й веде до ревізії", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(await screen.findByText("Обробку завершено")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Перейти до ревізії/ }),
    ).toHaveClass("btn-primary");
  });

  it("підсумок недоступний, доки обробка триває", async () => {
    const { clients } = makeClients({
      duplication: {
        getAnalysisRun: vi.fn().mockResolvedValue({ run: analysisRun() }),
      },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    await screen.findByText("Збір публікацій");
    expect(
      screen.queryByRole("button", { name: "Підсумок імпорту" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Продовжити у фоні/ }),
    ).toBeInTheDocument();
  });

  it("завершена обробка веде до ревізії й відкриває підсумок запуску", async () => {
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({
            status: RunStatus.SUCCEEDED,
            channelsProcessed: 2,
            postsIngested: 980,
            channels: [
              channelProgress({
                state: ChannelIngestionState.DONE,
                postsIngested: 568,
              }),
              channelProgress({
                channelId: ANALYTICS,
                state: ChannelIngestionState.REUSED,
                postsIngested: 412,
              }),
            ],
          }),
        }),
      },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );
    expect(
      await screen.findByRole("link", { name: /Перейти до ревізії/ }),
    ).toHaveAttribute("href", "/review");

    await userEvent.click(
      await screen.findByRole("button", { name: "Підсумок імпорту" }),
    );

    expect(
      await screen.findByText("Імпортовано 2 каналів"),
    ).toBeInTheDocument();
    expect(labelled("Уже в каталозі")).toHaveTextContent("1");
    expect(labelled("Нових каналів зібрано")).toHaveTextContent("1");
    expect(labelled("Публікацій оброблено")).toHaveTextContent("980");
    expect(labelled("Пар оцінено")).toHaveTextContent("1");
    expect(labelled("Рекомендацій сформовано")).toHaveTextContent("3");
    expect(labelled("Вікно збору")).toHaveTextContent("30 днів");
  });

  it("з підсумку видно повернутися до стану обробки", async () => {
    const { clients } = makeClients();
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Підсумок імпорту" }),
    );
    await screen.findByText("Імпортовано 2 каналів");

    await userEvent.click(screen.getByRole("button", { name: "Стан обробки" }));

    expect(await screen.findByText("Збір публікацій")).toBeInTheDocument();
  });

  it("вікно збору читається із запуску, а не з параметрів аналізу", async () => {
    const getAnalysisSettings = vi.fn();
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi.fn().mockResolvedValue({
          run: ingestionRun({ status: RunStatus.SUCCEEDED, windowDays: 45 }),
        }),
      },
      analysisSettings: { getAnalysisSettings },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Підсумок імпорту" }),
    );

    expect(labelled("Вікно збору")).toHaveTextContent("45 днів");
    expect(getAnalysisSettings).not.toHaveBeenCalled();
  });

  it("незавершений запуск найновішого знімка відкриває крок обробки", async () => {
    const { clients } = makeClients({
      subscription: {
        listSnapshots: vi
          .fn()
          .mockResolvedValue({ snapshots: [{ id: "snap-1", memberCount: 2 }] }),
      },
      ingestion: {
        listIngestionRuns: vi
          .fn()
          .mockResolvedValue({ runs: [ingestionRun()] }),
        getIngestionRun: vi
          .fn()
          .mockResolvedValue({ run: ingestionRun({ postsIngested: 120 }) }),
      },
    });
    renderScreen(clients);

    expect(await screen.findByText("Збір публікацій")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Обрати файл" }),
    ).not.toBeInTheDocument();
  });

  it("завершений запуск не перехоплює екран", async () => {
    const { clients } = makeClients({
      subscription: {
        listSnapshots: vi
          .fn()
          .mockResolvedValue({ snapshots: [{ id: "snap-1", memberCount: 2 }] }),
      },
      ingestion: {
        listIngestionRuns: vi
          .fn()
          .mockResolvedValue({
            runs: [ingestionRun({ status: RunStatus.SUCCEEDED })],
          }),
      },
      duplication: {
        listAnalysisRuns: vi
          .fn()
          .mockResolvedValue({ runs: [finishedAnalysis()] }),
      },
    });
    renderScreen(clients);

    expect(
      await screen.findByRole("button", { name: "Обрати файл" }),
    ).toBeInTheDocument();
  });

  it("нечитний стан запусків не блокує імпорт", async () => {
    const { clients } = makeClients({
      subscription: {
        listSnapshots: vi
          .fn()
          .mockRejectedValue(new ConnectError("нема", Code.Unavailable)),
      },
    });
    renderScreen(clients);

    expect(
      await screen.findByRole("button", { name: "Обрати файл" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("порожній перелік має власне пояснення, а не порожню таблицю", async () => {
    const { clients } = makeClients({
      subscription: {
        importSubscriptions: vi
          .fn()
          .mockResolvedValue({ subscriptions: [], importableCount: 0 }),
      },
    });
    renderScreen(clients);

    await userEvent.click(
      screen.getByRole("button", { name: "Зчитати діалоги" }),
    );

    expect(
      await screen.findByText("Жодного діалогу не розпізнано"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("показує помилку читання й повторює запит", async () => {
    const importSubscriptions = vi
      .fn()
      .mockRejectedValueOnce(
        new ConnectError("сервіс лежить", Code.Unavailable),
      )
      .mockResolvedValue({
        subscriptions: subscriptions(),
        importableCount: 2,
      });
    const { clients } = makeClients({ subscription: { importSubscriptions } });
    renderScreen(clients);

    await userEvent.click(
      screen.getByRole("button", { name: "Зчитати діалоги" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сервіс тимчасово недоступний. Спробуйте пізніше.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Новини Первинні")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(importSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("помилка підтвердження повторює саме підтвердження", async () => {
    const createSnapshot = vi
      .fn()
      .mockRejectedValueOnce(
        new ConnectError("не можна", Code.PermissionDenied),
      )
      .mockResolvedValue({ snapshot: { id: "snap-1", memberCount: 2 } });
    const { clients, importSubscriptions } = makeClients({
      subscription: { createSnapshot },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Недостатньо прав для цієї дії.",
    );
    expect(
      screen.getByRole("checkbox", { name: "Імпортувати «Аналітика Дня»" }),
    ).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByText("Збір публікацій")).toBeInTheDocument();
    expect(createSnapshot).toHaveBeenCalledTimes(2);
    expect(importSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("вікно збору не вигадується, коли запуск його не повідомляє", async () => {
    const { clients } = makeClients({
      ingestion: {
        getIngestionRun: vi
          .fn()
          .mockResolvedValue({
            run: ingestionRun({ status: RunStatus.SUCCEEDED, windowDays: 0 }),
          }),
      },
    });
    await readDialogs(clients);

    await userEvent.click(
      screen.getByRole("button", { name: /Підтвердити 2 канал/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Підсумок імпорту" }),
    );

    expect(labelled("Вікно збору")).toHaveTextContent("—");
  });
});
