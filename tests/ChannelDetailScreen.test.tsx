import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ChannelAddedSource, ChannelStatus } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";
import { RelationKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";

import type { Clients } from "../src/lib/clients";
import { ChannelDetailScreen } from "../src/screens/ChannelDetailScreen";

const SUBJECT = "2a000000-0000-4000-8000-000000000001";
const OTHER = "2b000000-0000-4000-8000-000000000002";
const SNAPSHOT = "11111111-1111-1111-1111-111111111111";

function catalogChannel(hasProfile = false, status = ChannelStatus.ACTIVE) {
  return {
    channel: {
      id: SUBJECT,
      socialMediaType: SocialMediaType.TELEGRAM,
      foreignId: "200000001",
      username: "primary",
      title: "Новини Первинні",
    },
    status,
    hasProfile,
    profile: hasProfile
      ? {
          channelId: SUBJECT,
          postCount: 128,
          postsPerDay: 4.2,
          uniqueContentShare: 0.67,
          topDomains: [],
        }
      : undefined,
  };
}

function makeClients(overrides: Record<string, unknown> = {}) {
  const clients = {
    catalog: {
      getChannel: vi.fn().mockResolvedValue({ channel: catalogChannel() }),
      listChannelAddedEvents: vi.fn().mockResolvedValue({ events: [] }),
      pauseChannel: vi
        .fn()
        .mockResolvedValue({ channel: catalogChannel(false, ChannelStatus.PAUSED) }),
      resumeChannel: vi.fn().mockResolvedValue({ channel: catalogChannel() }),
      removeChannel: vi.fn().mockResolvedValue({}),
      ...(overrides.catalog as object),
    },
    subscription: {
      listSnapshots: vi.fn().mockResolvedValue({
        snapshots: [{ id: SNAPSHOT, version: 1n, frozenAt: { seconds: 100n } }],
      }),
      ...(overrides.subscription as object),
    },
    duplication: {
      listCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
      ...(overrides.duplication as object),
    },
  } as unknown as Clients;

  return { clients };
}

function renderScreen(clients: Clients, isAdmin = false) {
  return render(
    <MemoryRouter initialEntries={[`/channels/${SUBJECT}`]}>
      <Routes>
        <Route
          path="/channels/:channelId"
          element={<ChannelDetailScreen clients={clients} isAdmin={isAdmin} />}
        />
        <Route path="/catalog" element={<p>Перелік каталогу</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("екран каналу", () => {
  it("показує ідентичність каналу разом із платформою й `foreign_id`", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(await screen.findByRole("heading", { name: "Новини Первинні" })).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("200000001")).toBeInTheDocument();
  });

  it("канал без аналізу позначено як ще не проаналізований", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(await screen.findByText("ще не проаналізовано")).toBeInTheDocument();
  });

  it("канал із аналізом показує характеристики", async () => {
    const { clients } = makeClients({
      catalog: {
        getChannel: vi.fn().mockResolvedValue({ channel: catalogChannel(true) }),
        listChannelAddedEvents: vi.fn().mockResolvedValue({ events: [] }),
      },
    });
    renderScreen(clients);

    expect(await screen.findByText("128")).toBeInTheDocument();
    expect(screen.queryByText("ще не проаналізовано")).not.toBeInTheDocument();
  });

  it("відсутність кандидатів має власний стан", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(await screen.findByText("Кандидатів для цього каналу немає.")).toBeInTheDocument();
  });

  it("залишає лише кандидатів, що стосуються цього каналу", async () => {
    const foreign = "2c000000-0000-4000-8000-000000000003";
    const { clients } = makeClients({
      duplication: {
        listCandidates: vi.fn().mockResolvedValue({
          candidates: [
            {
              id: "cand-1",
              leftChannelId: SUBJECT,
              rightChannelId: OTHER,
              relation: RelationKind.PERSISTENT_DUPLICATION,
              confidence: 0.9,
              hasSufficientData: true,
            },
            {
              id: "cand-2",
              leftChannelId: foreign,
              rightChannelId: OTHER,
              relation: RelationKind.PARTIAL_OVERLAP,
              confidence: 0.5,
              hasSufficientData: true,
            },
          ],
        }),
      },
    });
    renderScreen(clients);

    expect(await screen.findByText(/Канал 2b000000…/)).toBeInTheDocument();
    expect(screen.queryByText(/Канал 2c000000…/)).not.toBeInTheDocument();
  });

  it("без жодного снапшоту пояснює, чому кандидатів немає", async () => {
    const { clients } = makeClients({
      subscription: { listSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }) },
    });
    renderScreen(clients);

    expect(await screen.findByText("Жодного снапшоту ще немає.")).toBeInTheDocument();
  });

  it("показує стан каналу позначкою", async () => {
    const { clients } = makeClients();
    renderScreen(clients);

    expect(await screen.findByText("Активний")).toBeInTheDocument();
  });

  it("ставить канал на паузу й показує новий стан", async () => {
    const { clients } = makeClients();
    renderScreen(clients, true);
    await screen.findByRole("heading", { name: "Новини Первинні" });

    await userEvent.click(screen.getByRole("button", { name: "Поставити на паузу" }));

    await waitFor(() =>
      expect(clients.catalog.pauseChannel).toHaveBeenCalledWith({ channelId: SUBJECT }),
    );
    expect(await screen.findByText("Пауза")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Відновити" })).toBeInTheDocument();
  });

  it("керування станом недоступне ролі user", async () => {
    const { clients } = makeClients();
    renderScreen(clients, false);

    await screen.findByRole("heading", { name: "Новини Первинні" });
    expect(screen.queryByRole("button", { name: "Поставити на паузу" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Видалити" })).not.toBeInTheDocument();
  });

  it("видалення вимагає підтвердити username каналу", async () => {
    const { clients } = makeClients();
    renderScreen(clients, true);
    await screen.findByRole("heading", { name: "Новини Первинні" });

    await userEvent.click(screen.getByRole("button", { name: "Видалити" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Видалити канал" });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Підтвердіть username каналу"), "primary");
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(clients.catalog.removeChannel).toHaveBeenCalledWith({
        channelId: SUBJECT,
        usernameConfirmation: "primary",
        retainPosts: true,
      }),
    );
    expect(await screen.findByText("Перелік каталогу")).toBeInTheDocument();
  });

  it("ховає історію додавання від ролі user", async () => {
    const { clients } = makeClients();
    renderScreen(clients, false);

    await screen.findByRole("heading", { name: "Новини Первинні" });
    expect(screen.queryByRole("heading", { name: "Історія додавання" })).not.toBeInTheDocument();
    expect(clients.catalog.listChannelAddedEvents).not.toHaveBeenCalled();
  });

  it("показує ролі admin історію, звужену до цього каналу", async () => {
    const listChannelAddedEvents = vi.fn().mockResolvedValue({
      events: [
        {
          id: "evt-1",
          channelId: SUBJECT,
          source: ChannelAddedSource.MANUAL,
          appUserId: "user-1",
          appUsername: "admin",
        },
      ],
    });
    const { clients } = makeClients({
      catalog: {
        getChannel: vi.fn().mockResolvedValue({ channel: catalogChannel() }),
        listChannelAddedEvents,
      },
    });
    renderScreen(clients, true);

    expect(await screen.findByRole("heading", { name: "Історія додавання" })).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(listChannelAddedEvents).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: SUBJECT }),
    );
  });

  it("порожня історія має власний стан", async () => {
    const { clients } = makeClients();
    renderScreen(clients, true);

    expect(await screen.findByText("Записів про додавання немає.")).toBeInTheDocument();
  });

  it("канал поза каталогом показує помилку й шлях назад", async () => {
    const { clients } = makeClients({
      catalog: {
        getChannel: vi.fn().mockRejectedValue(new ConnectError("немає", Code.NotFound)),
        listChannelAddedEvents: vi.fn().mockResolvedValue({ events: [] }),
      },
    });
    renderScreen(clients);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "До каталогу каналів" })).toBeInTheDocument();
  });
});
