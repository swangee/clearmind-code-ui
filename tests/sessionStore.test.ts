import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_TOKEN_KEY,
  createSessionStore,
  sessionInterceptor,
} from "../src/lib/clients";

type Next = Parameters<Interceptor>[0];
type Request = Parameters<ReturnType<Interceptor>>[0];

function request(): Request {
  return { header: new Headers() } as unknown as Request;
}

function callWith(store: ReturnType<typeof createSessionStore>, next: Next) {
  return sessionInterceptor(store)(next)(request());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("сховище токена сесії", () => {
  it("бере збережений токен вкладки при створенні", () => {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, "stored-token");

    const store = createSessionStore(() => {});

    expect(store.token).toBe("stored-token");
  });

  it("запис токена лишає його у сховищі вкладки", () => {
    const store = createSessionStore(() => {});

    store.token = "session-token";

    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe("session-token");
  });

  it("порожній токен прибирає ключ, а не лишає порожнім", () => {
    const store = createSessionStore(() => {});
    store.token = "session-token";

    store.token = "";

    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it("недоступне сховище не заважає сесії в памʼяті", () => {
    const unavailable = () => {
      throw new Error("сховище недоступне");
    };
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(unavailable);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(unavailable);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(unavailable);

    const store = createSessionStore(() => {});
    expect(store.token).toBe("");

    expect(() => {
      store.token = "session-token";
    }).not.toThrow();
    expect(store.token).toBe("session-token");
  });
});

describe("перехоплювач сесії", () => {
  it("додає токен до заголовка запиту", async () => {
    const store = createSessionStore(() => {});
    store.token = "session-token";
    const next = vi.fn(async (call: Request) => ({ header: call.header }));

    await callWith(store, next as unknown as Next);

    const sent = next.mock.calls[0][0];
    expect(sent.header.get("Authorization")).toBe("Bearer session-token");
  });

  it("UNAUTHENTICATED гасить токен усюди й сповіщає застосунок", async () => {
    const onUnauthenticated = vi.fn();
    const store = createSessionStore(onUnauthenticated);
    store.token = "dead-token";
    const next = vi.fn().mockRejectedValue(new ConnectError("сесія недійсна", Code.Unauthenticated));

    await expect(callWith(store, next as unknown as Next)).rejects.toThrow();

    expect(store.token).toBe("");
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(onUnauthenticated).toHaveBeenCalled();
  });

  it("інша помилка лишає токен на місці", async () => {
    const onUnauthenticated = vi.fn();
    const store = createSessionStore(onUnauthenticated);
    store.token = "live-token";
    const next = vi.fn().mockRejectedValue(new ConnectError("недоступно", Code.Unavailable));

    await expect(callWith(store, next as unknown as Next)).rejects.toThrow();

    expect(store.token).toBe("live-token");
    expect(window.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe("live-token");
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
