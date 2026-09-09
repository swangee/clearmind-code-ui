import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { AnalysisSchedule } from "@clearmind/contracts/clearmind/v1/analysis_settings_pb";

import type { Clients } from "../src/lib/clients";
import { AnalysisSettingsScreen } from "../src/screens/AnalysisSettingsScreen";

const AUTHOR = "3c000000-0000-4000-8000-000000000001";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    collectionWindowDays: 45,
    minPostsPerChannel: 25,
    minPostLength: 200,
    duplicateThreshold: 0.62,
    postSimilarityThreshold: 0.85,
    timeMatchWindowHours: 12,
    weights: { lexical: 0.55, links: 0.2, forwards: 0.15, timing: 0.1 },
    minClusterSize: 4,
    sourceOverlapThreshold: 0.55,
    recommendationsPerAccount: 8,
    lossWarningThreshold: 0.35,
    excludedTopics: ["Погода"],
    schedule: AnalysisSchedule.WEEKLY,
    updatedAt: undefined,
    updatedByAppUserId: "",
    ...overrides,
  };
}

function makeClients() {
  const getAnalysisSettings = vi.fn().mockResolvedValue({ settings: settings() });
  const updateAnalysisSettings = vi.fn().mockImplementation(async () => ({
    settings: settings({
      updatedAt: Timestamp.fromDate(new Date("2026-03-04T10:15:00Z")),
      updatedByAppUserId: AUTHOR,
    }),
  }));

  return {
    clients: {
      analysisSettings: { getAnalysisSettings, updateAnalysisSettings },
    } as unknown as Clients,
    getAnalysisSettings,
    updateAnalysisSettings,
  };
}

async function retype(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

describe("екран параметрів аналізу", () => {
  beforeEach(() => vi.clearAllMocks());

  it("показує у формі збережені параметри", async () => {
    const { clients } = makeClients();

    render(<AnalysisSettingsScreen clients={clients} />);

    expect(await screen.findByLabelText("Вікно збору, днів")).toHaveValue("45");
    expect(screen.getByLabelText("Мінімум публікацій у каналі")).toHaveValue("25");
    expect(screen.getByLabelText("Мінімальна довжина допису")).toHaveValue("200");
    expect(screen.getByLabelText("Поріг дубля, частка збігів")).toHaveValue("0.62");
    expect(screen.getByLabelText("Вікно збігу за часом, год")).toHaveValue("12");
    expect(screen.getByLabelText("Лексика")).toHaveValue("0.55");
    expect(screen.getByLabelText("Рекомендацій на акаунт")).toHaveValue("8");
    expect(screen.getByRole("radio", { name: "Щотижня" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Погода" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Сповіщення" })).not.toBeChecked();
  });

  it("повідомляє, що параметри діють із наступного запуску й записуються з автором", async () => {
    const { clients } = makeClients();

    render(<AnalysisSettingsScreen clients={clients} />);

    expect(
      await screen.findByText(
        "Зміни застосуються з наступного запуску. Кожне збереження записується з автором і часом.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ручні рішення по парах зберігаються/),
    ).toBeInTheDocument();
  });

  it("не надсилає параметри, поки сума ваг не дорівнює одиниці", async () => {
    const { clients, updateAnalysisSettings } = makeClients();
    render(<AnalysisSettingsScreen clients={clients} />);
    await screen.findByLabelText("Лексика");

    await retype("Лексика", "0.9");

    expect(screen.getByText(/Сума 1[.,]35 — має дорівнювати 1/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Зберегти параметри" }));

    expect(updateAnalysisSettings).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Сума ваг сигналів має дорівнювати 1/,
    );
  });

  it("не надсилає параметри з недодатним вікном збору", async () => {
    const { clients, updateAnalysisSettings } = makeClients();
    render(<AnalysisSettingsScreen clients={clients} />);
    await screen.findByLabelText("Вікно збору, днів");

    await retype("Вікно збору, днів", "0");
    await userEvent.click(screen.getByRole("button", { name: "Зберегти параметри" }));

    expect(updateAnalysisSettings).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/«Вікно збору, днів»/);
  });

  it("надсилає повний набір параметрів і показує, ким і коли його збережено", async () => {
    const { clients, updateAnalysisSettings } = makeClients();
    render(<AnalysisSettingsScreen clients={clients} />);
    await screen.findByLabelText("Вікно збору, днів");

    await retype("Вікно збору, днів", "60");
    await userEvent.click(screen.getByRole("checkbox", { name: "Сповіщення" }));
    await userEvent.click(screen.getByRole("radio", { name: "Вручну" }));
    await userEvent.click(screen.getByRole("button", { name: "Зберегти параметри" }));

    await waitFor(() =>
      expect(updateAnalysisSettings).toHaveBeenCalledWith({
        settings: {
          collectionWindowDays: 60,
          minPostsPerChannel: 25,
          minPostLength: 200,
          duplicateThreshold: 0.62,
          postSimilarityThreshold: 0.85,
          timeMatchWindowHours: 12,
          weights: { lexical: 0.55, links: 0.2, forwards: 0.15, timing: 0.1 },
          minClusterSize: 4,
          sourceOverlapThreshold: 0.55,
          recommendationsPerAccount: 8,
          lossWarningThreshold: 0.35,
          excludedTopics: ["Погода", "Сповіщення"],
          schedule: AnalysisSchedule.MANUAL,
        },
      }),
    );

    expect(await screen.findByText(/^Збережено\./)).toBeInTheDocument();
    expect(screen.getByText("3c000000…")).toBeInTheDocument();
  });

  it("показує повідомлення сервера, коли межі порушені", async () => {
    const { clients, updateAnalysisSettings } = makeClients();
    updateAnalysisSettings.mockRejectedValueOnce(
      new ConnectError("сума ваг має дорівнювати одиниці", Code.InvalidArgument),
    );
    render(<AnalysisSettingsScreen clients={clients} />);
    await screen.findByLabelText("Вікно збору, днів");

    await userEvent.click(screen.getByRole("button", { name: "Зберегти параметри" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("сума ваг має дорівнювати одиниці");
  });

  it("скидає чернетку до типових значень без звернення до сервера", async () => {
    const { clients, updateAnalysisSettings } = makeClients();
    render(<AnalysisSettingsScreen clients={clients} />);
    await screen.findByLabelText("Вікно збору, днів");

    await userEvent.click(screen.getByRole("button", { name: "Скинути до типових" }));

    expect(screen.getByLabelText("Вікно збору, днів")).toHaveValue("30");
    expect(screen.getByLabelText("Лексика")).toHaveValue("0.5");
    expect(screen.getByRole("radio", { name: "Щодня" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Погода" })).not.toBeChecked();
    expect(updateAnalysisSettings).not.toHaveBeenCalled();
  });

  it("дає повторити запит, якщо параметри не завантажилися", async () => {
    const { clients, getAnalysisSettings } = makeClients();
    getAnalysisSettings.mockRejectedValueOnce(new Error("сервіс недоступний"));

    render(<AnalysisSettingsScreen clients={clients} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("сервіс недоступний");

    await userEvent.click(screen.getByRole("button", { name: "Повторити" }));

    expect(await screen.findByLabelText("Вікно збору, днів")).toHaveValue("45");
  });
});
