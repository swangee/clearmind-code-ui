import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";
import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { AnalysisStage } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type {
  ChannelIngestionProgress,
  IngestionRun,
} from "@clearmind/contracts/clearmind/v1/ingestion_pb";
import { ChannelIngestionState } from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import { Section } from "./Page";
import { Empty, RunFailureNote } from "./States";
import {
  analysisPhase,
  analysisStageLabels,
  channelIngestionStateLabels,
  channelIngestionStateTag,
  dateTime,
  failedStage,
  fmtInt,
  isCancellable,
  isRunFinished,
  processingStageLabels,
  processingStages,
  runStatusLabels,
} from "../lib/format";
import {
  panel,
  table,
  tagAccent,
  tagNeutral,
  tagOutline,
  textFaint,
  textMuted,
} from "../lib/styles";

const stageOrder: AnalysisStage[] = [
  AnalysisStage.LOADING_POSTS,
  AnalysisStage.SIGNATURES,
  AnalysisStage.PAIR_COMPARISON,
  AnalysisStage.RECOMMENDATIONS,
];

export function settledChannels(run?: IngestionRun): number {
  return (run?.channels ?? []).filter(
    (channel) =>
      channel.state === ChannelIngestionState.DONE ||
      channel.state === ChannelIngestionState.REUSED ||
      channel.state === ChannelIngestionState.FAILED,
  ).length;
}

export function freshlyCollected(run?: IngestionRun): number {
  return (run?.channels ?? []).filter(
    (channel) => channel.state === ChannelIngestionState.DONE,
  ).length;
}

export function reusedChannels(run?: IngestionRun): number {
  return (run?.channels ?? []).filter(
    (channel) => channel.state === ChannelIngestionState.REUSED,
  ).length;
}

export function recommendationsBuilt(run?: AnalysisRun): number {
  return (
    run?.stages.find((stage) => stage.stage === AnalysisStage.RECOMMENDATIONS)
      ?.doneUnits ?? 0
  );
}

function collectShare(run?: IngestionRun): number {
  const total = run?.channelsTotal ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((settledChannels(run) / total) * 100));
}

function analysisShare(run?: AnalysisRun): number {
  const known = (run?.stages ?? []).filter(
    (stage) => stage.totalUnits !== undefined,
  );
  if (known.length === 0) return 0;
  const sum = known.reduce((acc, stage) => {
    const total = stage.totalUnits ?? 0;
    if (total <= 0) return acc + 100;
    return acc + Math.min(100, (stage.doneUnits / total) * 100);
  }, 0);
  return Math.round(sum / stageOrder.length);
}

function remaining(
  run: IngestionRun | undefined,
  elapsedSeconds: number,
): string {
  const done = settledChannels(run);
  const total = run?.channelsTotal ?? 0;
  if (!run || done === 0 || done >= total) return "";
  const seconds = Math.round((elapsedSeconds / done) * (total - done));
  if (seconds < 60) return "менше хвилини лишилось";
  return `≈ ${Math.round(seconds / 60)} хв лишилось`;
}

export function elapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function note(channel: ChannelIngestionProgress): string {
  switch (channel.state) {
    case ChannelIngestionState.QUEUED:
      return "Очікує своєї черги";
    case ChannelIngestionState.COLLECTING:
      return "Читання історії каналу";
    case ChannelIngestionState.RATE_LIMITED:
      return channel.retryAfterSeconds === undefined
        ? "Ліміт запитів — очікування повтору"
        : `Ліміт запитів — повтор за ${fmtInt(channel.retryAfterSeconds)} с`;
    case ChannelIngestionState.DONE:
      return "Історію прочитано повністю";
    case ChannelIngestionState.REUSED:
      return channel.collectedAt
        ? `Збір від ${dateTime(channel.collectedAt)}`
        : "Взято з попереднього збору";
    case ChannelIngestionState.FAILED:
      return "Історію прочитати не вдалося";
    case ChannelIngestionState.SKIPPED:
      return "Канал на паузі в каталозі";
    default:
      return "—";
  }
}

function Bar({ share }: { share: number }) {
  return (
    <div
      role="presentation"
      style={{
        height: 4,
        borderRadius: 2,
        background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
      }}
    >
      <div
        style={{
          width: `${share}%`,
          height: 4,
          borderRadius: 2,
          background: "var(--color-accent)",
          transition: "width .3s",
        }}
      />
    </div>
  );
}

interface CardState {
  label: string;
  tag: string;
  warn: boolean;
}

function finishedState(status: RunStatus): CardState {
  const label = runStatusLabels[status];
  if (status === RunStatus.SUCCEEDED) {
    return { label, tag: tagNeutral, warn: false };
  }
  if (status === RunStatus.FAILED || status === RunStatus.PARTIAL) {
    return { label, tag: tagAccent, warn: true };
  }
  return { label, tag: tagOutline, warn: false };
}

function collectionState(run?: IngestionRun): CardState {
  if (!run) return { label: "Стан ще не відомий", tag: tagOutline, warn: false };
  if (isRunFinished(run.status)) return finishedState(run.status);
  if (run.status === RunStatus.RUNNING) {
    return { label: runStatusLabels[run.status], tag: tagAccent, warn: false };
  }
  return { label: runStatusLabels[run.status], tag: tagOutline, warn: false };
}

function StateTag({ state }: { state: CardState }) {
  return (
    <>
      {state.warn ? (
        <i
          className="ph ph-warning-circle"
          aria-hidden="true"
          style={{ fontSize: 16, color: "var(--color-accent)" }}
        />
      ) : null}
      <span className={state.tag}>{state.label}</span>
    </>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <span className={textMuted} style={{ fontSize: 11 }}>
        {label}
      </span>
    </div>
  );
}

function CollectionCard({ run }: { run?: IngestionRun }) {
  const state = collectionState(run);
  const share = collectShare(run);

  return (
    <section
      aria-label={processingStageLabels.collection}
      className={panel}
      style={{ padding: "18px 20px", gap: 14 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>
          {processingStageLabels.collection}
        </span>
        <StateTag state={state} />
        <span
          style={{
            marginLeft: "auto",
            fontSize: 20,
            fontFamily: "var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-accent)",
          }}
        >
          {share}%
        </span>
      </div>
      <Bar share={share} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        <Metric
          value={`${fmtInt(settledChannels(run))} / ${fmtInt(run?.channelsTotal ?? 0)}`}
          label="каналів опрацьовано"
        />
        <Metric
          value={fmtInt(run?.postsIngested ?? 0)}
          label="публікацій завантажено"
        />
        <Metric
          value={fmtInt(run?.rateLimitWaits ?? 0)}
          label="повторів після лімітів"
        />
      </div>
      <RunFailureNote failure={run?.failure} />
      <p
        className={`m-0 ${textFaint}`}
        style={{ fontSize: 12, lineHeight: 1.5 }}
      >
        Вікно збору — {fmtInt(run?.windowDays ?? 0)} днів за налаштуваннями
        сервісу. Канали, зібрані достатньо недавно, беруться з попереднього
        збору без повторного читання історії.
      </p>
    </section>
  );
}

function analysisState(run?: AnalysisRun): CardState {
  switch (analysisPhase(run)) {
    case "absent":
      return { label: "Ще не поставлено в чергу", tag: tagOutline, warn: false };
    case "awaiting-collection":
      return {
        label: "Очікує завершення збору",
        tag: tagOutline,
        warn: false,
      };
    case "queued":
      return {
        label:
          run?.queuePosition === undefined
            ? "У черзі"
            : run.queuePosition === 0
              ? "У черзі — наступний"
              : `У черзі — попереду ${fmtInt(run.queuePosition)}`,
        tag: tagOutline,
        warn: false,
      };
    case "running":
      return { label: "Виконується", tag: tagAccent, warn: false };
    default:
      return finishedState(run?.status ?? RunStatus.UNSPECIFIED);
  }
}

function AnalysisCard({
  run,
  onCancel,
  cancelling,
}: {
  run?: AnalysisRun;
  onCancel?: () => void;
  cancelling: boolean;
}) {
  const share = analysisShare(run);
  const state = analysisState(run);
  const byStage = new Map(run?.stages.map((stage) => [stage.stage, stage]));

  return (
    <section
      aria-label={processingStageLabels.analysis}
      className={panel}
      style={{ padding: "18px 20px", gap: 14 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>
          {processingStageLabels.analysis}
        </span>
        <StateTag state={state} />
        {isCancellable(run) && onCancel ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 10px", fontSize: 12 }}
            disabled={cancelling}
            onClick={onCancel}
          >
            Скасувати
          </button>
        ) : null}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 20,
            fontFamily: "var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-accent)",
          }}
        >
          {share}%
        </span>
      </div>
      <Bar share={share} />
      <ol
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 9,
          margin: 0,
          padding: 0,
        }}
      >
        {stageOrder.map((stage) => {
          const progress = byStage.get(stage);
          const total = progress?.totalUnits;
          const done = progress?.doneUnits ?? 0;
          const complete = total !== undefined && done >= total;
          const started = done > 0 || complete;
          const icon = complete
            ? "ph ph-check-circle"
            : started
              ? "ph ph-circle-notch"
              : "ph ph-circle-dashed";

          return (
            <li
              key={stage}
              aria-label={analysisStageLabels[stage]}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                listStyle: "none",
              }}
              className={started ? undefined : textFaint}
            >
              <i
                className={icon}
                aria-hidden="true"
                style={{
                  fontSize: 14,
                  color: complete ? "inherit" : "var(--color-accent)",
                }}
              />
              <span>{analysisStageLabels[stage]}</span>
              <span
                className={textFaint}
                style={{ marginLeft: "auto", fontSize: 12 }}
              >
                {total === undefined
                  ? "—"
                  : `${fmtInt(done)} із ${fmtInt(total)}`}
              </span>
            </li>
          );
        })}
      </ol>
      <RunFailureNote failure={run?.failure} />
    </section>
  );
}

function ChannelTable({ run }: { run?: IngestionRun }) {
  const channels = run?.channels ?? [];

  if (channels.length === 0) {
    return (
      <Empty
        title="Поступ по каналах ще не відомий"
        hint="Запуск щойно стартував або він старший за появу поканального журналу."
      />
    );
  }

  return (
    <table className={table}>
      <caption className="sr-only">
        Канали снапшоту та їхній стан у запуску
      </caption>
      <thead>
        <tr>
          <th>Канал</th>
          <th>Ідентифікатор</th>
          <th>Джерело</th>
          <th style={{ textAlign: "right" }}>Публікацій зібрано</th>
          <th style={{ width: 220 }}>Остання дія</th>
          <th style={{ width: 130 }}>Стан</th>
        </tr>
      </thead>
      <tbody>
        {channels.map((channel) => {
          const idle = channel.state === ChannelIngestionState.QUEUED;
          return (
            <tr key={channel.channelId}>
              <td className={idle ? textMuted : undefined}>
                {channel.title || "Без назви"}
              </td>
              <td className={textMuted}>
                {channel.username ? `@${channel.username}` : "—"}
              </td>
              <td className={textMuted} style={{ fontSize: 13 }}>
                {channel.state === ChannelIngestionState.REUSED
                  ? "З каталогу"
                  : "Новий збір"}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {idle ? "—" : fmtInt(channel.postsIngested)}
              </td>
              <td className={textMuted} style={{ fontSize: 12 }}>
                {note(channel)}
              </td>
              <td>
                <span className={channelIngestionStateTag(channel.state)}>
                  {channelIngestionStateLabels[channel.state]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface Props {
  ingestion?: IngestionRun;
  analysis?: AnalysisRun;
  elapsedSeconds: number;
  actions: React.ReactNode;
  onCancelAnalysis?: () => void;
  busy?: boolean;
}

export function ImportProcessing({
  ingestion,
  analysis,
  elapsedSeconds,
  actions,
  onCancelAnalysis,
  busy = false,
}: Props) {
  const collecting =
    ingestion !== undefined && !isRunFinished(ingestion.status);
  const cancelled = analysis?.status === RunStatus.CANCELLED;
  const stages = processingStages(ingestion, analysis);
  const broken = failedStage(stages);
  const settled =
    analysis !== undefined && stages.every((stage) => isRunFinished(stage.status));
  const done = settled && stages.every((stage) => stage.status === RunStatus.SUCCEEDED);
  const partial =
    settled &&
    !done &&
    broken === undefined &&
    !cancelled &&
    stages.some((stage) => stage.status === RunStatus.PARTIAL);
  const left = remaining(ingestion, elapsedSeconds);

  const running = {
    label: runStatusLabels[RunStatus.RUNNING],
    tag: tagAccent,
    warn: false,
  };
  const header = broken
    ? {
        title: "Обробку не завершено",
        icon: "ph ph-warning-circle",
        state: {
          label: runStatusLabels[RunStatus.FAILED],
          tag: tagAccent,
          warn: true,
        },
      }
    : done
      ? {
          title: "Обробку завершено",
          icon: "ph ph-check-circle",
          state: {
            label: runStatusLabels[RunStatus.SUCCEEDED],
            tag: tagNeutral,
            warn: false,
          },
        }
      : partial
        ? {
            title: "Обробку завершено частково",
            icon: "ph ph-warning-circle",
            state: {
              label: runStatusLabels[RunStatus.PARTIAL],
              tag: tagAccent,
              warn: true,
            },
          }
        : cancelled
          ? {
              title: processingStageLabels.analysis,
              icon: "ph ph-graph",
              state: {
                label: runStatusLabels[RunStatus.CANCELLED],
                tag: tagOutline,
                warn: false,
              },
            }
          : collecting
            ? {
                title: "Збір публікацій з підключених каналів",
                icon: "ph ph-cloud-arrow-down",
                state: running,
              }
            : {
                title: processingStageLabels.analysis,
                icon: "ph ph-graph",
                state: running,
              };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        className={panel}
        style={{
          padding: "14px 18px",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <i
          className={header.icon}
          aria-hidden="true"
          style={{ fontSize: 22, color: "var(--color-accent)" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>
            {header.title}
          </span>
          <span className={textMuted} style={{ fontSize: 12 }}>
            {fmtInt(ingestion?.channelsTotal ?? 0)} каналів у снапшоті ·{" "}
            {elapsed(elapsedSeconds)}
            {left ? ` · ${left}` : ""}
          </span>
          {broken ? (
            <span style={{ fontSize: 12, color: "var(--color-accent)" }}>
              Не вдався етап «{broken.title}»
            </span>
          ) : null}
        </div>
        <StateTag state={header.state} />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {actions}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          gap: 16,
        }}
      >
        <CollectionCard run={ingestion} />
        <AnalysisCard
          run={analysis}
          onCancel={onCancelAnalysis}
          cancelling={busy}
        />
      </div>

      <Section title="Підключені канали">
        <ChannelTable run={ingestion} />
      </Section>

      <p
        className={`m-0 ${textFaint}`}
        style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 720 }}
      >
        {broken
          ? `Обробка зупинилася на етапі «${broken.title}». Ревізія цього снапшоту лишиться порожньою, доки етап не пройде успішно.`
          : "Обробка триває на сервері — сторінку можна закрити. Ревізія доступна одразу після завершення аналізу; до того вона показує попередній знімок."}
      </p>
    </div>
  );
}
