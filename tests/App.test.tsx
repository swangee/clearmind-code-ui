import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Role } from "@clearmind/contracts/clearmind/v1/auth_pb";

import { App } from "../src/App";
import type { Clients } from "../src/lib/clients";

interface AuthMethods {
  passwordEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string;
}

const passwordOnly: AuthMethods = {
  passwordEnabled: true,
  googleEnabled: false,
  googleClientId: "",
};

function makeClients(
  role: Role,
  overrides: Record<string, unknown> = {},
  authMethods: AuthMethods | Error = passwordOnly,
) {
  const login = vi.fn().mockResolvedValue({
    sessionToken: "token-1",
    user: { id: "user-1", username: "admin", role },
  });
  const loginWithGoogle = vi.fn().mockResolvedValue({
    sessionToken: "token-2",
    user: { id: "user-1", username: "admin", role },
    created: false,
  });
  const getAuthMethods =
    authMethods instanceof Error
      ? vi.fn().mockRejectedValue(authMethods)
      : vi.fn().mockResolvedValue(authMethods);
  const logout = vi.fn().mockResolvedValue({});

  return {
    clients: {
      auth: { login, loginWithGoogle, getAuthMethods, logout },
      catalog: {
        listChannels: vi.fn().mockResolvedValue({ channels: [], page: { nextPageToken: "" } }),
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
      ...overrides,
    } as unknown as Clients,
    login,
    loginWithGoogle,
    getAuthMethods,
    logout,
  };
}

async function signIn() {
  await userEvent.type(screen.getByLabelText(/Імʼя користувача/), "admin");
  await userEvent.type(screen.getByLabelText(/Пароль/), "secret");
  await userEvent.click(screen.getByRole("button", { name: "Увійти" }));
}

function stubGoogleIdentity() {
  const state: { credentialCallback?: (response: { credential: string }) => void } = {};
  const initialize = vi.fn((config: { callback: (response: { credential: string }) => void }) => {
    state.credentialCallback = config.callback;
  });
  const prompt = vi.fn();
  const cancel = vi.fn();

  (window as unknown as { google: unknown }).google = { accounts: { id: { initialize, prompt, cancel } } };

  return {
    initialize,
    prompt,
    cancel,
    async emitCredential(credential: string) {
      await act(async () => {
        state.credentialCallback?.({ credential });
      });
    },
  };
}

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

describe("оболонка застосунку", () => {
  it("розвертає неавтентифікований перехід на екран входу", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Увійти" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("після входу показує розділ, на який ішов користувач", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    await screen.findByRole("navigation");
    await waitFor(() => expect(clients.subscription.listSnapshots).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Такої сторінки немає" })).not.toBeInTheDocument();
  });

  it("ховає адміністративні розділи від ролі user", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    await screen.findByRole("navigation");
    expect(screen.getByRole("link", { name: "Ревізія" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Імпорт" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Каталог" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Параметри" })).not.toBeInTheDocument();
  });

  it("показує адміністративні розділи ролі admin", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    await screen.findByRole("navigation");
    expect(screen.getByRole("link", { name: "Каталог" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Параметри" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Імпорт" })).not.toBeInTheDocument();
  });

  it("не пускає роль user на параметри аналізу за прямою адресою", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    expect(screen.queryByRole("heading", { name: "Параметри аналізу" })).not.toBeInTheDocument();
    expect(clients.analysisSettings.getAnalysisSettings).not.toHaveBeenCalled();
  });

  it("не пускає роль user на адмінський маршрут навіть за прямою адресою", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/events"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    expect(await screen.findByRole("heading", { name: "Ревізія підписок" })).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Додані канали" })).not.toBeInTheDocument();
    expect(clients.catalog.listChannelAddedEvents).not.toHaveBeenCalled();
  });

  it("веде адміністратора до його стартового розділу замість закритої адреси", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/import"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    expect(await screen.findByRole("heading", { name: "Каталог каналів" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Такої сторінки немає" })).not.toBeInTheDocument();
  });

  it("позначає в меню розділ, у якому користувач зараз", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/pairs"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    expect(screen.getByRole("link", { name: "Пари" })).toHaveAttribute("aria-current", "page");
    for (const label of ["Каталог", "Рекомендації", "Запуски", "Параметри"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
    }
  });

  it("невідома адреса після входу лишається 404", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/немає-такого"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    expect(await screen.findByRole("heading", { name: "Такої сторінки немає" })).toBeInTheDocument();
  });

  it("пускає роль admin на адмінський маршрут за прямою адресою", async () => {
    const { clients } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/events"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    expect(await screen.findByRole("heading", { name: "Додані канали" })).toBeInTheDocument();
  });

  it("вихід гасить сесію й повертає до екрана входу", async () => {
    const { clients, logout } = makeClients(Role.ADMIN);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    await userEvent.click(screen.getByRole("button", { name: "Вийти" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Увійти" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("невідома адреса показує 404 замість порожнього екрана", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/немає-такого"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();

    expect(await screen.findByRole("heading", { name: "Такої сторінки немає" })).toBeInTheDocument();
  });

  it.each([
    ["/catalog", Role.ADMIN],
    ["/pairs", Role.ADMIN],
    ["/admin/recommendations", Role.ADMIN],
    ["/runs", Role.ADMIN],
    ["/settings", Role.ADMIN],
    ["/events", Role.ADMIN],
    ["/import", Role.USER],
    ["/review", Role.USER],
    ["/recommendations", Role.USER],
    ["/account", Role.USER],
    ["/немає-такого", Role.USER],
  ])("розділ %s стоїть у спільній рамці сторінки", async (path, role) => {
    const { clients } = makeClients(role);

    render(
      <MemoryRouter initialEntries={[path]}>
        <App clients={clients} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Увійти" });
    await signIn();
    await screen.findByRole("navigation");

    expect(document.querySelector("main > section.page")).not.toBeNull();
  });
});

describe("способи входу", () => {
  const googleEnabled: AuthMethods = {
    passwordEnabled: true,
    googleEnabled: true,
    googleClientId: "client-1.apps.googleusercontent.com",
  };

  it("показує кнопку Google, коли розгортання її пропонує", async () => {
    const google = stubGoogleIdentity();
    const { clients } = makeClients(Role.USER, {}, googleEnabled);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );

    const button = await screen.findByRole("button", { name: "Увійти через Google" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(google.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: googleEnabled.googleClientId }),
    );

    expect(screen.queryByLabelText(/Імʼя користувача/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Вхід для адміністратора" }));
    expect(screen.getByLabelText(/Імʼя користувача/)).toHaveFocus();
  });

  it("без Google показує лише форму облікових даних", async () => {
    const { clients } = makeClients(Role.USER);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Увійти" });
    expect(screen.queryByRole("button", { name: "Увійти через Google" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Імʼя користувача/)).toBeInTheDocument();
  });

  it("непрочитані способи входу не блокують вхід формою", async () => {
    const { clients, getAuthMethods } = makeClients(
      Role.ADMIN,
      {},
      new Error("способи входу недоступні"),
    );

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Увійти" });
    await waitFor(() => expect(getAuthMethods).toHaveBeenCalled());
    await signIn();

    expect(await screen.findByRole("navigation")).toBeInTheDocument();
  });

  it("ID-токен від Google заводить користувача в застосунок", async () => {
    const google = stubGoogleIdentity();
    const { clients, loginWithGoogle } = makeClients(Role.USER, {}, googleEnabled);

    render(
      <MemoryRouter initialEntries={["/review"]}>
        <App clients={clients} />
      </MemoryRouter>,
    );

    const button = await screen.findByRole("button", { name: "Увійти через Google" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(google.prompt).toHaveBeenCalled();

    await google.emitCredential("google-id-token");

    expect(loginWithGoogle).toHaveBeenCalledWith({ idToken: "google-id-token" });
    expect(await screen.findByRole("navigation")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("google-id-token");
  });
});
