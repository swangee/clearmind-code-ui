import {
  test,
  expect,
  expectNoHorizontalOverflow,
  expectNoSeriousAccessibilityViolations,
} from "./support/fixtures";
import { ContractError } from "./support/connect";
import { analysisRun, ingestionRun } from "./support/data";

const SETTLED = {
  ListIngestionRuns: {
    runs: [ingestionRun("RUN_STATUS_SUCCEEDED", { channelsProcessed: 29, postsIngested: 1160 })],
    page: {},
  },
  ListAnalysisRuns: { runs: [analysisRun("RUN_STATUS_SUCCEEDED")], page: {} },
};

const SCREENS = [
  { path: "/review", name: "ревізія", role: "ROLE_USER" },
  { path: "/import", name: "імпорт", role: "ROLE_USER" },
  { path: "/account", name: "акаунт", role: "ROLE_USER" },
  { path: "/runs", name: "запуски", role: "ROLE_ADMIN" },
] as const;

test.describe("інваріанти екранів", () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: без серйозних порушень доступності`, async ({ app, page }) => {
      await app.open(screen.path, SETTLED, screen.role);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page);
    });

    test(`${screen.name}: вміщується у вікно`, async ({ app, page }) => {
      await app.open(screen.path, SETTLED, screen.role);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test(`${screen.name}: має єдиний заголовок першого рівня`, async ({ app, page }) => {
      await app.open(screen.path, SETTLED, screen.role);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }

  test("закрита для ролі адреса теж має назву сторінки", async ({ app, page }) => {
    await app.open("/runs", SETTLED, "ROLE_USER");
    await expect(page.getByRole("heading", { level: 1, name: "Такої сторінки немає" })).toBeVisible();
  });

  test("кожна дія має доступну назву", async ({ app, page }) => {
    await app.open("/review", SETTLED);
    await expect(page.getByRole("main")).toBeVisible();

    const nameless = await page
      .getByRole("button")
      .and(page.locator(":not([aria-hidden='true'])"))
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const label = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim();
            return label === "";
          })
          .map((node) => node.outerHTML.slice(0, 120)),
      );

    expect(nameless, "дії без доступної назви").toEqual([]);
  });

  test("фокус із клавіатури видно", async ({ app, page }) => {
    await app.open("/review", SETTLED);
    await expect(page.getByRole("main")).toBeVisible();

    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();

    const visible = await focused.evaluate((node) => {
      const style = getComputedStyle(node);
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      return outline || style.boxShadow !== "none";
    });
    expect(visible, "у сфокусованого елемента немає видимого стану фокуса").toBe(true);
  });

  test("недоступний контракт дає помилку з повтором, а не порожній екран", async ({
    app,
    page,
  }) => {
    await app.open("/review", {
      ListSnapshots: new ContractError("unavailable", "api-gateway недоступний", 503),
    });

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторити" })).toBeVisible();
  });

  test("повільна відповідь показує стан завантаження", async ({ app, page }) => {
    await app.open("/review", {
      ListSnapshots: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { snapshots: [], page: {} };
      },
    });

    await expect(page.getByRole("status")).toBeVisible();
  });

  test("токен сесії не потрапляє в сторінку", async ({ app, page }) => {
    await app.open("/review", SETTLED);
    await expect(page.getByRole("main")).toBeVisible();

    const markup = await page.content();
    expect(markup).not.toContain("e2e-session-token");
  });
});
