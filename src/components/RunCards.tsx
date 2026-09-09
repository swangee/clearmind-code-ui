import type { ChannelError } from "@clearmind/contracts/clearmind/v1/common_pb";
import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";
import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import {
  analysisTriggerLabels,
  dateTime,
  fmtInt,
  runStatusLabels,
  shortId,
} from "../lib/format";
import { textFaint, textSoft } from "../lib/styles";

function statusTag(status: RunStatus): string {
  if (status === RunStatus.RUNNING || status === RunStatus.FAILED) return "tag tag-accent";
  if (status === RunStatus.PENDING || status === RunStatus.CANCELLED) return "tag tag-outline";
  return "tag tag-neutral";
}

function queueNote(run: AnalysisRun): string {
  if (run.awaitedIngestionRunId && run.status === RunStatus.PENDING) {
    return "Очікує завершення збору";
  }
  if (run.queuePosition === undefined) return "";
  return run.queuePosition === 0
    ? "Наступний у черзі"
    : `У черзі — попереду ${fmtInt(run.queuePosition)}`;
}

export function IngestionRunCard({ run }: { run: IngestionRun }) {
  return (
    <article
      className="card elev-sm"
      style={{ padding: "18px 20px", gap: 14 }}
      aria-label="Збір публікацій"
    >
      <div className="flex items-center gap-2.5">
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Збір публікацій</span>
        <span className={statusTag(run.status)}>{runStatusLabels[run.status]}</span>
      </div>

      <div className="flex" style={{ gap: 28 }}>
        <Metric value={`${run.channelsProcessed} / ${run.channelsTotal}`} label="каналів" />
        <Metric value={String(run.postsIngested)} label="публікацій" />
        <Metric value={String(run.channelErrors.length)} label="помилки" accent />
      </div>

      <RunMeta startedAt={dateTime(run.startedAt)} finishedAt={dateTime(run.finishedAt)} />
      <ChannelErrors errors={run.channelErrors} />
    </article>
  );
}

export function AnalysisRunCard({ run }: { run: AnalysisRun }) {
  return (
    <article
      className="card elev-sm"
      style={{ padding: "18px 20px", gap: 14 }}
      aria-label="Аналіз дублювання"
    >
      <div className="flex items-center gap-2.5">
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Аналіз дублювання</span>
        <span className={statusTag(run.status)}>{runStatusLabels[run.status]}</span>
        <span className="tag tag-outline">{analysisTriggerLabels[run.trigger]}</span>
        <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
          Версія алгоритму: {run.algorithmVersion}
        </span>
      </div>

      <div className="flex" style={{ gap: 28 }}>
        <Metric value={String(run.pairsCompared)} label="пар порівняно" />
        <Metric value={String(run.candidatesFound)} label="кандидатів" />
        <Metric value={String(run.postsAnalyzed)} label="публікацій" />
      </div>

      <RunMeta startedAt={dateTime(run.startedAt)} finishedAt={dateTime(run.finishedAt)} />
      {queueNote(run) ? (
        <p className={`m-0 ${textFaint}`} style={{ fontSize: 12 }}>
          {queueNote(run)}
        </p>
      ) : null}
      <ChannelErrors errors={run.channelErrors} />
    </article>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
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

function RunMeta({ startedAt, finishedAt }: { startedAt: string; finishedAt: string }) {
  return (
    <p className={`m-0 ${textFaint}`} style={{ fontSize: 12 }}>
      Початок: {startedAt}. Завершення: {finishedAt}.
    </p>
  );
}

function ChannelErrors({ errors }: { errors: ChannelError[] }) {
  if (errors.length === 0) return null;

  return (
    <ul className={`m-0 flex list-none flex-col gap-1 p-0 ${textSoft}`} style={{ fontSize: 12 }}>
      {errors.map((channelError) => (
        <li key={channelError.channelId}>
          Канал {channelError.channelUsername || shortId(channelError.channelId)}:{" "}
          {channelError.message}
        </li>
      ))}
    </ul>
  );
}
