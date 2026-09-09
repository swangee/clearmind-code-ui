import type { Page, Route } from "@playwright/test";

export type Reply = unknown | ((request: RequestContext) => unknown | Promise<unknown>);

export interface RequestContext {
  body: Record<string, unknown>;
  call: number;
}

export class ContractError {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly status = 500,
  ) {}
}

export type Stubs = Record<string, Reply>;

const CONNECT_ROUTE = /\/clearmind\.v1\.[A-Za-z]+\/[A-Za-z]+$/;

export interface ConnectStub {
  calls: Readonly<Record<string, number>>;
  missing: readonly string[];
  update: (stubs: Stubs) => void;
}

export async function stubContract(page: Page, stubs: Stubs): Promise<ConnectStub> {
  const replies: Stubs = { ...stubs };
  const calls: Record<string, number> = {};
  const missing: string[] = [];

  await page.route(CONNECT_ROUTE, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, "");
    const method = path.split("/")[1] ?? "";
    const seen = calls[method] ?? 0;
    calls[method] = seen + 1;

    const reply = replies[path] ?? replies[method];
    if (reply === undefined) {
      if (!missing.includes(path)) missing.push(path);
      await fulfilError(
        route,
        new ContractError("unimplemented", `e2e: немає сценарної відповіді на ${path}`, 501),
      );
      return;
    }

    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const value =
      typeof reply === "function"
        ? await (reply as (c: RequestContext) => unknown | Promise<unknown>)({ body, call: seen })
        : reply;

    if (value instanceof ContractError) {
      await fulfilError(route, value);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value ?? {}),
    });
  });

  return {
    get calls() {
      return { ...calls };
    },
    get missing() {
      return [...missing];
    },
    update(next: Stubs) {
      Object.assign(replies, next);
    },
  };
}

async function fulfilError(route: Route, error: ContractError): Promise<void> {
  await route.fulfill({
    status: error.status,
    contentType: "application/json",
    body: JSON.stringify({ code: error.code, message: error.message }),
  });
}
