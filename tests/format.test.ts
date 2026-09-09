import { describe, expect, it } from "vitest";

import { ImportChannelOutcome } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";
import {
  ChannelIngestionState,
  IngestionRun,
} from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import {
  collectionCoverage,
  importChannelOutcomeLabels,
  percent,
  percentWidth,
  pluralForm,
} from "../src/lib/format";

function channels(state: ChannelIngestionState, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    channelId: `channel-${state}-${index}`,
    state,
  }));
}

function run(total: number, ...rows: ReturnType<typeof channels>[]): IngestionRun {
  return new IngestionRun({
    id: "irun-1",
    status: RunStatus.PARTIAL,
    channelsTotal: total,
    channels: rows.flat(),
  });
}

describe("склад збору, що дійшов до порівняння", () => {
  it("рахує перевикористані канали нарівні зі щойно зібраними", () => {
    const coverage = collectionCoverage(
      run(
        29,
        channels(ChannelIngestionState.DONE, 14),
        channels(ChannelIngestionState.REUSED, 7),
        channels(ChannelIngestionState.FAILED, 8),
      ),
    );

    expect(coverage).toEqual({ delivered: 21, total: 29 });
  });

  it("не зараховує каналів, за якими запуск нічого не лишив", () => {
    const coverage = collectionCoverage(
      run(
        10,
        channels(ChannelIngestionState.DONE, 4),
        channels(ChannelIngestionState.FAILED, 3),
        channels(ChannelIngestionState.SKIPPED, 2),
        channels(ChannelIngestionState.COLLECTING, 1),
      ),
    );

    expect(coverage).toEqual({ delivered: 4, total: 10 });
  });

  it("не називає складу для запуску без поканальних рядків", () => {
    expect(collectionCoverage(run(29))).toBeUndefined();
  });

  it("не називає складу, коли запуску немає взагалі", () => {
    expect(collectionCoverage(undefined)).toBeUndefined();
  });
});

describe("відсоток значення доказу", () => {
  it("не зводить малий ненульовий сигнал до нуля", () => {
    expect(percent(0.003)).toBe("<1%");
    expect(percent(0.0049)).toBe("<1%");
  });

  it("залишає справжній нуль нулем", () => {
    expect(percent(0)).toBe("0%");
  });

  it("округлює решту значень, як і раніше", () => {
    expect(percent(0.006)).toBe("1%");
    expect(percent(0.674)).toBe("67%");
    expect(percent(1)).toBe("100%");
  });

  it("дає смужці доказу мінімальну видиму ширину чинним CSS", () => {
    expect(percentWidth(0.003)).toBe("1%");
    expect(percentWidth(0)).toBe("0%");
    expect(percentWidth(0.674)).toBe("67%");
  });
});

describe("форма слова за числом", () => {
  const forms = ["канал", "канали", "каналів"] as const;

  it("бере однину для чисел, що закінчуються на 1", () => {
    expect(pluralForm(1, forms)).toBe("канал");
    expect(pluralForm(21, forms)).toBe("канал");
    expect(pluralForm(101, forms)).toBe("канал");
  });

  it("бере форму двох-чотирьох для 2, 3 і 4", () => {
    expect(pluralForm(2, forms)).toBe("канали");
    expect(pluralForm(23, forms)).toBe("канали");
  });

  it("бере множину для решти, зокрема для підступного десятка", () => {
    expect(pluralForm(0, forms)).toBe("каналів");
    expect(pluralForm(5, forms)).toBe("каналів");
    expect(pluralForm(11, forms)).toBe("каналів");
    expect(pluralForm(12, forms)).toBe("каналів");
    expect(pluralForm(14, forms)).toBe("каналів");
    expect(pluralForm(25, forms)).toBe("каналів");
  });
});

describe("підписи доль імпорту з джерела", () => {
  it("кожна доля контракту має власний підпис", () => {
    const values = Object.values(ImportChannelOutcome).filter(
      (value): value is ImportChannelOutcome => typeof value === "number",
    );
    const labels = values.map((value) => importChannelOutcomeLabels[value]);

    for (const label of labels) expect(label).toBeTruthy();
    expect(new Set(labels).size).toBe(labels.length);
  });
});
