import { Code, ConnectError } from "@connectrpc/connect";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Role } from "@clearmind/contracts/clearmind/v1/auth_pb";

import { App } from "../src/App";
import { SESSION_TOKEN_KEY, type Clients } from "../src/lib/clients";

function storedSession(token = "session-token") {
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

function makeClients(getCurrentUser: ReturnType<typeof vi.fn>, role = Role.ADMIN) {
  const login = vi.fn().mockResolvedValue({
    sessionToken: "session-token",
    user: { id: "user-1", username: "admin", role },
  });
  const logout = vi.fn().mockResolvedValue({});
  const listChannels = vi.fn().mockResolvedValue({ channels: [], page: { nextPageToken: "" } });

  return {
    clients: {
      auth: {
        login,
        logout,
        getCurrentUser,
        loginWithGoogle: vi.fn().mockResolvedValue({}),
        getAuthMethods: vi
          .fn()
          .mockResolvedValue({ passwordEnabled: true, googleEnabled: false, googleClientId: "" }),
      },
      catalog: {
        listChannels,
        listChannelAddedEvents: vi.fn().mockResolvedValue({ events: [], page: {} }),
      },
      account: { getStatus: vi.fn().mockResolvedValue({ state: 0 }) },
      subscription: { listSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }) },
      ingestion: { listIngestionRuns: vi.fn().mockResolvedValue({ runs: [] }) },
      duplication: {
        listAnalysisRuns: vi.fn().mockResolvedValue({ runs: [] }),
        listCandidates: vi.fn().mockResolvedValue({ candidates: [], page: {} }),
        listClusters: vi.fn().mockResolvedValue({ clusters: [], page: {} }),
      },
      recommendation: {
        listRecommendations: vi.fn().mockResolvedValue({ recommendations: [], page: {} }),
        listDecisions: vi.fn().mockResolvedValue({ decisions: [], page: {} }),
      },
      analysisSettings: { getAnalysisSettings: vi.fn().mockResolvedValue({ settings: undefined }) },
    } as unknown as Clients,
    login,
    logout,
    listChannels,
  };
}

function renderAt(path: string, clients: Clients) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App clients={clients} />
    </MemoryRouter>,
  );
}

async function signIn() {
  await userEvent.type(screen.getByLabelText(/Імʼя користувача/), "admin");
  await userEvent.type(screen.getByLabelText(/Пароль/), "secret");
  await userEvent.click(screen.getByRole("button", { name: "Увійти" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("відновлення сесії", () => {
  it("повертає користувача в його розділ замість екрана входу", async () => {
    storedSession();
    const getCurrentUser = vi.fn().mockResolvedValue({
      user: { id: "user-1", username: "admin", role: Role.ADMIN },
    });
    const { clients } = makeClients(getCurrentUser);

    renderAt("/catalog", clients);

    expect(await screen.findByRole("heading", { name: "Каталог каналів" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Увійти" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Параметри" })).toBeInTheDocument();
  });

  it("не вирішує адреси, доки роль невідома", async () => {
    storedSession();
    const getCurrentUser = vi.fn().mockReturnValue(new Promise(() => {}));
    const { clients, listChannels } = makeClients(getCurrentUser);

    renderAt("/catalog", clients);

    expect(await screen.findByText("Відновлюємо сесію…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Увійти" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Такої сторінки немає" })).not.toBeInTheDocument();
    expect(listChannels).not.toHaveBeenCalled();
  });

  it("відхилений токен веде на вхід без повідомлення про помилку", async () => {
    storedSession("dead-token");
    const getCurrentUser = vi
      .fn()
      .mockRejectedValue(new ConnectError("сесія недійсна", Code.Unauthenticated));
    const { clients } = makeClients(getCurrentUser);

    renderAt("/catalog", clients);

    expect(await screen.findByRole("button", { name: "Увійти" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("dead-token");
  });

  it("помилка мережі не забирає збереженого токена", async () => {
    storedSession("live-token");
    const getCurrentUser = vi
      .fn()
      .mockRejectedValue(new ConnectError("недоступно", Code.Unavailable));
    const { clients } = makeClients(getCurrentUser);

    renderAt("/catalog", clients);

    expect(await screen.findByRole("button", { name: "Увійти" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe("live-token");
  });

  it("відновлює сесію рівно одним викликом", async () => {
    storedSession();
    const getCurrentUser = vi.fn().mockResolvedValue({
      user: { id: "user-1", username: "admin", role: Role.ADMIN },
    });
    const { clients } = makeClients(getCurrentUser);

    renderAt("/catalog", clients);
    await screen.findByRole("navigation");

    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });
});

describe("сховище сесії у застосунку", () => {
  it("вхід лишає токен вкладці, а вихід його забирає", async () => {
    const getCurrentUser = vi.fn().mockResolvedValue({});
    const { clients, logout } = makeClients(getCurrentUser);

    renderAt("/login", clients);
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe("session-token");
    expect(getCurrentUser).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Вийти" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it("недоступне сховище не заважає ані ввійти, ані працювати", async () => {
    const unavailable = () => {
      throw new Error("сховище недоступне");
    };
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(unavailable);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(unavailable);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(unavailable);
    const { clients } = makeClients(vi.fn().mockResolvedValue({}));

    renderAt("/login", clients);
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    expect(await screen.findByRole("navigation")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Каталог каналів" })).toBeInTheDocument();
  });
});
