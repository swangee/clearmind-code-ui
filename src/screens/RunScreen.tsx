import { useState, type ReactNode } from "react";

import type { Timestamp } from "@bufbuild/protobuf";

import type { ChannelAddedEvent } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import type { ChannelError } from "@clearmind/contracts/clearmind/v1/common_pb";
import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";
import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import { Section } from "../components/Page";
import { Empty, ErrorState, Loading, RunFailureNote } from "../components/States";
import { useRunLauncher } from "../hooks/useRunLauncher";
import type { Clients } from "../lib/clients";
import {
  analysisTriggerLabels,
  channelAddedSourceLabels,
  dateTime,
  fmtInt,
  isCancellable,
  isRunFinished,
  runStatusLabels,
  shortId,
} from "../lib/format";
import {
  field,
  fieldGroup,
  primaryButton,
  secondaryButton,
  segmented,
  segmentedOption,
  table,
  textFaint,
  textMuted,
  textSoft,
} from "../lib/styles";

interface Props {
  clients: Clients;
  snapshotId: string;
  snapshotPicker?: ReactNode;
  latestIngestion?: IngestionRun;
  latestAnalysis?: AnalysisRun;
  adminEvents?: ChannelAddedEvent[];
  pending?: boolean;
  pollIntervalMs?: number;
}

const DEFAULT_WINDOW_DAYS = 30;

const trackColor = "color-mix(in srgb, var(--color-text) 10%, transparent)";

type LogKind = "errors" | "admin";

type LogFilter = LogKind | "all";

interface LogRow {
  key: string;
  at?: Timestamp;
  kind: LogKind;
  level: string;
  levelTag: string;
  source: string;
  text: string;
}

const logFilters: { value: LogFilter; label: string }[] = [
  { value: "all", label: "Усі" },
  { value: "errors", label: "Помилки" },
  { value: "admin", label: "Дії адміна" },
];

export function RunScreen({
  clients,
  snapshotId,
  snapshotPicker,
  latestIngestion,
  latestAnalysis,
  adminEvents = [],
  pending = false,
  pollIntervalMs,
}: Props) {
  const [windowInput, setWindowInput] = useState(String(DEFAULT_WINDOW_DAYS));
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const runs = useRunLauncher(clients, pollIntervalMs);

  const windowDays = parseWindow(windowInput);
  const ingestion = runs.ingestion ?? latestIngestion;
  const analysis = runs.analysis ?? latestAnalysis;
  const headline: IngestionRun | AnalysisRun | undefined = ingestion ?? analysis;
  const unknown = pending && headline === undefined;
  const canStart = snapshotId !== "" && !runs.busy;

  const logRows = buildLog(ingestion, analysis, adminEvents);
  const visibleRows = logFilter === "all" ? logRows : logRows.filter((row) => row.kind === logFilter);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 25 }}>
            {headline === undefined ? "Запуски" : `Запуск #${shortId(headline.id)}`}
          </h1>
          <p className="page-summary">{headlineNote(headline, ingestion, snapshotId)}</p>
        </div>

        {snapshotPicker}

        <div className={fieldGroup} style={{ width: 150, marginLeft: "auto" }}>
          <label htmlFor="run-window-days">Вікно збору, днів</label>
          <input
            id="run-window-days"
            className={field}
            type="number"
            min={1}
            inputMode="numeric"
            value={windowInput}
            onChange={(event) => setWindowInput(event.target.value)}
          />
        </div>

        <button
          type="button"
          className={primaryButton}
          style={{ height: 36 }}
          disabled={!canStart}
          onClick={() => void runs.runPipeline(snapshotId, windowDays)}
        >
          <i className="ph ph-play" aria-hidden="true" />
          Новий запуск
        </button>
      </div>

      {runs.error === "" ? null : <ErrorState message={runs.error} />}

      {unknown ? (
        <Loading label="Завантаження стану запусків…" />
      ) : headline === undefined ? (
        <Empty
          title="Для цього снапшоту ще не було запусків."
          hint="Задайте вікно збору й натисніть «Новий запуск»."
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
            gap: 14,
          }}
        >
          <IngestionProgressCard run={ingestion} />
          <AnalysisProgressCard
            run={analysis}
            disabled={!canStart}
            onStart={() => void runs.startAnalysis(snapshotId)}
            onCancel={(runId) => void runs.cancelAnalysis(runId)}
          />
        </div>
      )}

      <Section
        title="Журнал подій"
        actions={
          <div className={segmented} role="radiogroup" aria-label="Фільтр журналу">
            {logFilters.map((option) => (
              <label key={option.value} className={segmentedOption}>
                <input
                  type="radio"
                  name="run-log-filter"
                  value={option.value}
                  checked={logFilter === option.value}
                  onChange={() => setLogFilter(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        }
      >
        {unknown ? null : visibleRows.length === 0 ? (
          <Empty
            title="Подій немає."
            hint="Сюди потрапляють помилки по каналах із запусків і додавання каналів до каталогу."
          />
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Час</th>
                <th style={{ width: 110 }}>Рівень</th>
                <th style={{ width: 190 }}>Сервіс</th>
                <th>Подія</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td className={`tabular-nums ${textMuted}`}>{dateTime(row.at)}</td>
                  <td>
                    <span className={row.levelTag}>{row.level}</span>
                  </td>
                  <td className={textSoft}>{row.source}</td>
                  <td>{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function parseWindow(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_WINDOW_DAYS;
}

function headlineNote(
  headline: IngestionRun | AnalysisRun | undefined,
  ingestion: IngestionRun | undefined,
  snapshotId: string,
): string {
  const snapshot = headline?.snapshotId || snapshotId;
  const parts = [snapshot === "" ? "Снапшот не обрано" : `Снапшот ${shortId(snapshot)}`];
  if (ingestion !== undefined) parts.push(`вікно ${ingestion.windowDays} днів`);
  if (headline !== undefined) parts.push(`початок ${dateTime(headline.startedAt)}`);
  return parts.join(" · ");
}

function statusTag(status: RunStatus): string {
  if (status === RunStatus.RUNNING || status === RunStatus.FAILED) return "tag tag-accent";
  if (status === RunStatus.PENDING) return "tag tag-outline";
  return "tag tag-neutral";
}

function runTime(run?: { startedAt?: Timestamp; finishedAt?: Timestamp }): string {
  if (run === undefined) return "—";
  return dateTime(run.finishedAt ?? run.startedAt);
}

function ratio(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function IngestionProgressCard({ run }: { run?: IngestionRun }) {
  const percent =
    run === undefined
      ? 0
      : run.channelsTotal > 0
        ? ratio(run.channelsProcessed, run.channelsTotal)
        : isRunFinished(run.status)
          ? 100
          : 0;

  return (
    <article className="card elev-sm" style={{ padding: "18px 20px", gap: 14 }} aria-label="Прогрес збору публікацій">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Збір публікацій</span>
        <span className={run === undefined ? "tag tag-outline" : statusTag(run.status)}>
          {run === undefined ? "Не виконувався" : runStatusLabels[run.status]}
        </span>
        <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
          {runTime(run)}
        </span>
      </div>

      <ProgressBar label="Прогрес збору публікацій" percent={percent} />

      <RunFailureNote failure={run?.failure} />

      <div style={{ display: "flex", gap: 28 }}>
        <Metric
          value={run === undefined ? "—" : `${fmtInt(run.channelsProcessed)} / ${fmtInt(run.channelsTotal)}`}
          label="каналів"
        />
        <Metric value={run === undefined ? "—" : fmtInt(run.postsIngested)} label="публікацій" />
        <Metric value={run === undefined ? "—" : fmtInt(run.channelErrors.length)} label="помилки" accent />
      </div>

      <ErrorNotes errors={run?.channelErrors ?? []} />
    </article>
  );
}

function AnalysisProgressCard({
  run,
  disabled,
  onStart,
  onCancel,
}: {
  run?: AnalysisRun;
  disabled: boolean;
  onStart: () => void;
  onCancel: (runId: string) => void;
}) {
  const percent = run !== undefined && isRunFinished(run.status) ? 100 : 0;

  return (
    <article className="card elev-sm" style={{ padding: "18px 20px", gap: 14 }} aria-label="Прогрес аналізу дублювання">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Аналіз дублювання</span>
        <span className={run === undefined ? "tag tag-outline" : statusTag(run.status)}>
          {run === undefined ? "Не виконувався" : runStatusLabels[run.status]}
        </span>
        {run === undefined ? null : (
          <span className="tag tag-outline">{analysisTriggerLabels[run.trigger]}</span>
        )}
        <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
          {runTime(run)}
        </span>
      </div>

      <ProgressBar label="Прогрес аналізу дублювання" percent={percent} />

      <RunFailureNote failure={run?.failure} />

      <div style={{ display: "flex", gap: 28 }}>
        <Metric value={run === undefined ? "—" : fmtInt(run.pairsCompared)} label="пар оцінено" />
        <Metric value={run === undefined ? "—" : fmtInt(run.candidatesFound)} label="кандидатів" />
        <Metric value={run === undefined ? "—" : fmtInt(run.postsAnalyzed)} label="публікацій" />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className={secondaryButton}
          style={{ height: 32, fontSize: 13 }}
          disabled={disabled}
          onClick={onStart}
        >
          Запустити аналіз
        </button>
        {isCancellable(run) && run !== undefined ? (
          <button
            type="button"
            className={secondaryButton}
            style={{ height: 32, fontSize: 13 }}
            disabled={disabled}
            onClick={() => onCancel(run.id)}
          >
            Скасувати
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ProgressBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ height: 3, borderRadius: 2, background: trackColor }}
    >
      <div
        style={{
          width: `${percent}%`,
          height: 3,
          borderRadius: 2,
          background: "var(--color-accent)",
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        className="tabular-nums"
        style={{
          fontSize: 19,
          fontFamily: "var(--font-heading)",
          color: accent === true ? "var(--color-accent)" : undefined,
        }}
      >
        {value}
      </span>
      <span
        className={textFaint}
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </span>
    </div>
  );
}

function ErrorNotes({ errors }: { errors: ChannelError[] }) {
  if (errors.length === 0) return null;

  return (
    <ul
      className={`m-0 flex list-none flex-col gap-1.5 p-0 ${textSoft}`}
      style={{ fontSize: 12 }}
    >
      {errors.map((channelError, index) => (
        <li key={`${channelError.channelId}-${index}`}>
          {channelError.channelUsername || shortId(channelError.channelId)} — {channelError.message}
        </li>
      ))}
    </ul>
  );
}

function errorRows(source: string, prefix: string, errors: ChannelError[]): LogRow[] {
  return errors.map((channelError, index) => ({
    key: `${prefix}-${channelError.channelId}-${index}`,
    at: channelError.occurredAt,
    kind: "errors",
    level: "Помилка",
    levelTag: "tag tag-accent",
    source,
    text: `Помилка каналу ${channelError.channelUsername || shortId(channelError.channelId)}: ${channelError.message}`,
  }));
}

function adminRows(events: ChannelAddedEvent[]): LogRow[] {
  return events.map((event) => ({
    key: `catalog-${event.id}`,
    at: event.occurredAt,
    kind: "admin",
    level: "Дія адміна",
    levelTag: "tag tag-neutral",
    source: "Каталог каналів",
    text: `${channelAddedSourceLabels[event.source]}: канал ${shortId(event.channelId)}${
      event.appUsername ? ` · ${event.appUsername}` : ""
    }`,
  }));
}

function millis(at?: Timestamp): number {
  return at === undefined ? 0 : at.toDate().getTime();
}

function buildLog(
  ingestion: IngestionRun | undefined,
  analysis: AnalysisRun | undefined,
  events: ChannelAddedEvent[],
): LogRow[] {
  const rows = [
    ...errorRows("Збір публікацій", "ingestion", ingestion?.channelErrors ?? []),
    ...errorRows("Аналіз дублювання", "analysis", analysis?.channelErrors ?? []),
    ...adminRows(events),
  ];

  return rows.sort((left, right) => millis(right.at) - millis(left.at));
}
