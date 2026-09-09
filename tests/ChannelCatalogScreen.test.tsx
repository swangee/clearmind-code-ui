import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ChannelStatus } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";

import type { Clients } from "../src/lib/clients";
import { ChannelCatalogScreen } from "../src/screens/ChannelCatalogScreen";

const ANALYZED = "2a000000-0000-4000-8000-000000000001";
const FRESH = "2b000000-0000-4000-8000-000000000002";
const BROKEN = "2c000000-0000-4000-8000-000000000003";

function analyzedChannel(status = ChannelStatus.ACTIVE) {
  return {
    channel: {
      id: ANALYZED,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "200000001",
      username: "primary",
      title: "Новини Первинні",
    },
    hasProfile: true,
    status,
    profile: {
      channelId: ANALYZED,
      postCount: 128,
      postsPerDay: 4.2,
      uniqueContentShare: 0.67,
      topDomains: [{ domain: "example.ua", share: 0.4, postCount: 51 }],
    },
  };
}

function freshChannel(status = ChannelStatus.PAUSED) {
  return {
    channel: {
      id: FRESH,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "200000002",
      username: "fresh",
      title: "Щойно доданий",
    },
    hasProfile: false,
    status,
    profile: undefined,
  };
}

function brokenChannel() {
  return {
    channel: {
      id: BROKEN,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "200000003",
      username: "broken",
      title: "Зі збоєм збору",
    },
    hasProfile: false,
    status: ChannelStatus.ERROR,
    profile: undefined,
  };
}

function ingestionRun() {
  return { id: "ing-1", snapshotId: "snap-1", status: 3, channelErrors: [] };
}

function analysisRun() {
  return { id: "an-1", snapshotId: "snap-1", status: 3, channelErrors: [] };
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const listChannels = vi.fn().mockResolvedValue({
    channels: [analyzedChannel(), freshChannel(), brokenChannel()],
    page: { nextPageToken: "" },
  });
  const addChannel = vi.fn().mockResolvedValue({ channel: freshChannel() });
  const pauseChannel = vi
    .fn()
    .mockResolvedValue({ channel: analyzedChannel(ChannelStatus.PAUSED) });
  const resumeChannel = vi.fn().mockResolvedValue({ channel: freshChannel(ChannelStatus.ACTIVE) });
  const removeChannel = vi.fn().mockResolvedValue({});
  const listImportSources = vi.fn().mockResolvedValue({
    sources: [{ name: "telegator", socialMediaType: SocialMediaType.TELEGRAM, available: true }],
  });
  const importChannelsFromSource = vi.fn().mockResolvedValue({ results: [] });
  const createSnapshot = vi.fn().mockResolvedValue({ snapshot: { id: "snap-1" } });

  const clients = {
    catalog: {
      listChannels,
      addChannel,
      pauseChannel,
      resumeChannel,
      removeChannel,
      listImportSources,
      importChannelsFromSource,
      ...(overrides.catalog as object),
    },
    subscription: { createSnapshot },
    ingestion: {
      startIngestion: vi.fn().mockResolvedValue({ run: ingestionRun() }),
      getIngestionRun: vi.fn().mockResolvedValue({ run: ingestionRun() }),
    },
    duplication: {
      startAnalysis: vi.fn().mockResolvedValue({ run: analysisRun() }),
      getAnalysisRun: vi.fn().mockResolvedValue({ run: analysisRun() }),
    },
  } as unknown as Clients;

  return {
    clients,
    listChannels,
    addChannel,
    pauseChannel,
    resumeChannel,
    removeChannel,
    listImportSources,
    importChannelsFromSource,
    createSnapshot,
  };
}

function renderScreen(clients: Clients, isAdmin = false) {
  return render(
    <MemoryRouter>
      <ChannelCatalogScreen clients={clients} isAdmin={isAdmin} pollIntervalMs={1} />
    </MemoryRouter>,
  );
}

async function rowOf(title: string) {
  return (await screen.findByText(title)).closest("tr") as HTMLElement;
}

async function openAddForm() {
  await userEvent.click(screen.getByRole("button", { name: "Додати канал" }));
}

describe("екран каталогу каналів", () => {
  it("показує характеристики проаналізованого каналу", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    const row = await rowOf("Новини Первинні");
    expect(within(row).getByText("128")).toBeInTheDocument();
    expect(within(row).getByText("67%")).toBeInTheDocument();
    expect(within(row).getByText(/example\.ua/)).toBeInTheDocument();
  });

  it("канал без аналізу позначає характеристики відсутніми, а не нулями", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    const row = await rowOf("Щойно доданий");
    expect(within(row).getByText("ще немає даних")).toBeInTheDocument();
    expect(within(row).queryByText("0")).not.toBeInTheDocument();
  });

  it("рядок каталогу веде на екран каналу", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    const link = await screen.findByRole("link", { name: "Новини Первинні" });
    expect(link).toHaveAttribute("href", `/channels/${ANALYZED}`);
  });

  it("порожній каталог має власний стан", async () => {
    const { clients } = makeClients({
      catalog: { listChannels: vi.fn().mockResolvedValue({ channels: [], page: {} }) },
    });
    renderScreen(clients);

    expect(await screen.findByText("Каталог порожній.")).toBeInTheDocument();
  });

  it("помилка завантаження дає повторити запит", async () => {
    const listChannels = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("сервіс лежить", Code.Unavailable))
      .mockResolvedValue({ channels: [analyzedChannel()], page: {} });
    const { clients } = makeClients({ catalog: { listChannels } });
    renderScreen(clients);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сервіс тимчасово недоступний. Спробуйте пізніше.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));
    expect(await screen.findByText("Новини Первинні")).toBeInTheDocument();
  });

  it("показує стан кожного каналу позначкою", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(within(await rowOf("Новини Первинні")).getByText("Активний")).toBeInTheDocument();
    expect(within(await rowOf("Щойно доданий")).getByText("Пауза")).toBeInTheDocument();
    expect(within(await rowOf("Зі збоєм збору")).getByText("Помилка збору")).toBeInTheDocument();
  });

  it("фільтр стану звужує перелік", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("radio", { name: "Пауза" }));
    expect(screen.getByText("Щойно доданий")).toBeInTheDocument();
    expect(screen.queryByText("Новини Первинні")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "З помилками" }));
    expect(screen.getByText("Зі збоєм збору")).toBeInTheDocument();
    expect(screen.queryByText("Щойно доданий")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Усі" }));
    expect(screen.getByText("Новини Первинні")).toBeInTheDocument();
  });

  it("пошук звужує перелік за назвою або @username", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні");

    await userEvent.type(screen.getByLabelText("Пошук за назвою або @username"), "@fresh");
    expect(screen.getByText("Щойно доданий")).toBeInTheDocument();
    expect(screen.queryByText("Новини Первинні")).not.toBeInTheDocument();
  });

  it("ставить канал на паузу й показує новий стан", async () => {
    const { clients, pauseChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(
      screen.getByRole("button", { name: "Поставити «Новини Первинні» на паузу" }),
    );

    await waitFor(() => expect(pauseChannel).toHaveBeenCalledWith({ channelId: ANALYZED }));
    expect(within(await rowOf("Новини Первинні")).getByText("Пауза")).toBeInTheDocument();
  });

  it("відновлює канал зі стану паузи", async () => {
    const { clients, resumeChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Щойно доданий");

    await userEvent.click(screen.getByRole("button", { name: "Відновити «Щойно доданий»" }));

    await waitFor(() => expect(resumeChannel).toHaveBeenCalledWith({ channelId: FRESH }));
    expect(within(await rowOf("Щойно доданий")).getByText("Активний")).toBeInTheDocument();
  });

  it("керування станом недоступне ролі user", async () => {
    const { clients } = makeClients();
    renderScreen(clients, false);
    await screen.findByText("Новини Первинні");

    expect(
      screen.queryByRole("button", { name: "Поставити «Новини Первинні» на паузу" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Видалити «Новини Первинні»" })).not.toBeInTheDocument();
  });

  it("видалення заблоковане, доки username не підтверджено", async () => {
    const { clients, removeChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Видалити канал" });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Підтвердіть username каналу"), "не той");
    expect(confirm).toBeDisabled();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it("видаляє канал після підтвердження username", async () => {
    const { clients, removeChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Підтвердіть username каналу"), "@primary");
    await userEvent.click(within(dialog).getByRole("button", { name: "Видалити канал" }));

    await waitFor(() =>
      expect(removeChannel).toHaveBeenCalledWith({
        channelId: ANALYZED,
        usernameConfirmation: "primary",
        retainPosts: true,
      }),
    );
    await waitFor(() => expect(screen.queryByText("Новини Первинні")).not.toBeInTheDocument());
  });

  it("знімає позначку збереження публікацій", async () => {
    const { clients, removeChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByLabelText(
        "Зберегти зібрані публікації 30 днів для можливого відновлення",
      ),
    );
    await userEvent.type(within(dialog).getByLabelText("Підтвердіть username каналу"), "primary");
    await userEvent.click(within(dialog).getByRole("button", { name: "Видалити канал" }));

    await waitFor(() =>
      expect(removeChannel).toHaveBeenCalledWith(
        expect.objectContaining({ retainPosts: false }),
      ),
    );
  });

  it("невідповідне підтвердження з сервера подається читабельно", async () => {
    const removeChannel = vi
      .fn()
      .mockRejectedValue(new ConnectError("username mismatch", Code.InvalidArgument));
    const { clients } = makeClients({
      catalog: {
        listChannels: vi.fn().mockResolvedValue({ channels: [analyzedChannel()], page: {} }),
        removeChannel,
      },
    });
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Підтвердіть username каналу"), "primary");
    await userEvent.click(within(dialog).getByRole("button", { name: "Видалити канал" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Підтвердження не збігається з username каналу.",
    );
    expect(screen.getByText("Новини Первинні")).toBeInTheDocument();
  });

  it("діалог пропонує паузу як мʼякшу дію", async () => {
    const { clients, pauseChannel, removeChannel } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Поставити на паузу" }));

    await waitFor(() => expect(pauseChannel).toHaveBeenCalledWith({ channelId: ANALYZED }));
    expect(removeChannel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("діалог закривається з клавіатури", async () => {
    const { clients } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("button", { name: "Видалити «Новини Первинні»" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Підтвердіть username каналу")).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("ховає форму додавання від ролі user", async () => {
    const { clients } = makeClients();
    renderScreen(clients, false);

    await screen.findByText("Новини Первинні");
    expect(screen.queryByRole("button", { name: "Додати канал" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Додати" })).not.toBeInTheDocument();
  });

  it("показує форму додавання ролі admin", async () => {
    const { clients } = makeClients();
    renderScreen(clients, true);

    await screen.findByText("Новини Первинні");
    await openAddForm();
    expect(screen.getByRole("button", { name: "Додати" })).toBeInTheDocument();
  });

  it("додає канал за username і оновлює каталог", async () => {
    const { clients, addChannel, listChannels } = makeClients();
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");
    await openAddForm();

    await userEvent.type(screen.getByLabelText("Username каналу"), "@fresh");
    await userEvent.click(screen.getByRole("button", { name: "Додати" }));

    await waitFor(() => expect(addChannel).toHaveBeenCalled());
    expect(addChannel).toHaveBeenCalledWith({
      socialMediaType: SocialMediaType.TELEGRAM,
      username: "fresh",
      foreignId: "",
    });
    await waitFor(() => expect(listChannels).toHaveBeenCalledTimes(2));
  });

  it("показує помилку недостатніх прав біля форми", async () => {
    const { clients } = makeClients({
      catalog: {
        listChannels: vi
          .fn()
          .mockResolvedValue({ channels: [analyzedChannel()], page: {} }),
        addChannel: vi
          .fn()
          .mockRejectedValue(new ConnectError("немає прав", Code.PermissionDenied)),
      },
    });
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");
    await openAddForm();

    await userEvent.type(screen.getByLabelText("Username каналу"), "fresh");
    await userEvent.click(screen.getByRole("button", { name: "Додати" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Недостатньо прав для цієї дії.");
  });

  it("показує помилку неіснуючого каналу", async () => {
    const { clients } = makeClients({
      catalog: {
        listChannels: vi
          .fn()
          .mockResolvedValue({ channels: [analyzedChannel()], page: {} }),
        addChannel: vi
          .fn()
          .mockRejectedValue(new ConnectError("такого каналу не існує.", Code.NotFound)),
      },
    });
    renderScreen(clients, true);
    await screen.findByText("Новини Первинні");
    await openAddForm();

    await userEvent.type(screen.getByLabelText("Username каналу"), "немає");
    await userEvent.click(screen.getByRole("button", { name: "Додати" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Канал не додано/);
  });

  it("створює снапшот із вибраних каналів за їхніми UUID", async () => {
    const { clients, createSnapshot } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні");

    await userEvent.click(screen.getByRole("checkbox", { name: "Вибрати «Новини Первинні»" }));
    await userEvent.click(screen.getByRole("button", { name: "Запустити збір і аналіз" }));

    await waitFor(() => expect(createSnapshot).toHaveBeenCalledWith({ memberChannelIds: [ANALYZED] }));
  });

  it("не дає запустити аналіз без вибору каналів", async () => {
    const { clients } = makeClients();
    renderScreen(clients);
    await screen.findByText("Новини Первинні");

    expect(screen.getByRole("button", { name: "Запустити збір і аналіз" })).toBeDisabled();
  });
});
