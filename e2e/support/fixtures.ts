import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { stubContract, type ConnectStub, type Stubs } from "./connect";
import { baseline } from "./data";

const SESSION_TOKEN_KEY = "clearmind.session-token";

export interface AppFixture {
  open: (path: string, stubs?: Stubs, role?: "ROLE_USER" | "ROLE_ADMIN") => Promise<ConnectStub>;
}

export const test = base.extend<{ app: AppFixture; page: Page }>({
  page: async ({ page }, use) => {
    const noise: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (message.text().startsWith("Failed to load resource")) return;
      noise.push(message.text());
    });
    page.on("pageerror", (error) => noise.push(String(error)));

    await use(page);

    expect(noise, "сторінка не має писати помилок у консоль").toEqual([]);
  },

  app: async ({ page }, use) => {
    let installed: ConnectStub | undefined;

    await use({
      async open(path, stubs = {}, role = "ROLE_USER") {
        await page.addInitScript(
          ([key, value]) => window.sessionStorage.setItem(key, value),
          [SESSION_TOKEN_KEY, "e2e-session-token"] as const,
        );

        const stub = await stubContract(page, { ...baseline(role), ...stubs });
        installed = stub;
        await page.goto(path);
        return stub;
      },
    });

    expect(installed?.missing ?? [], "екран пішов по дані, яких сценарій не обіцяв").toEqual([]);
  },
});

export { expect };

export async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const serious = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    serious.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`),
    "серйозні порушення доступності",
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scroll: root.scrollWidth, client: root.clientWidth };
  });
  expect(
    overflow.scroll,
    `сторінка ширша за вікно: ${overflow.scroll}px проти ${overflow.client}px`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}
