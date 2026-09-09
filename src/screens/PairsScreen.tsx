import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { Channel } from "@clearmind/contracts/clearmind/v1/channel_pb";
import type {
  DuplicationCandidate,
  DuplicationCluster,
  MatchSample,
} from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { MatchVerdict, SignalKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";

import { Page, Section } from "../components/Page";
import { SnapshotPicker } from "../components/SnapshotPicker";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import {
  channelName,
  dateTime,
  duration,
  matchEventLabels,
  matchVerdictLabels,
  percent,
  percentWidth,
  relationLabels,
  shortId,
  signalLabels,
} from "../lib/format";
import { textFaint, textMuted, textSoft } from "../lib/styles";

const PAGE_SIZE = 100;
const DEFAULT_THRESHOLD = 60;

type MatchFilter = "all" | "auto" | "manual";

interface EffectiveMatch {
  manual: boolean;
  label: string;
  tagClass: string;
  note: string;
  verdict?: MatchVerdict;
}

function effectiveMatch(candidate: DuplicationCandidate): EffectiveMatch {
  const override = candidate.hasMatchOverride ? candidate.matchOverride : undefined;

  if (!override) {
    return {
      manual: false,
      label: relationLabels[candidate.relation],
      tagClass: "tag tag-neutral",
      note: "Автоматично",
    };
  }

  const who = override.appUsername || shortId(override.appUserId);
  return {
    manual: true,
    label: matchVerdictLabels[override.verdict],
    tagClass: "tag tag-accent",
    note: `Вручну · ${who} · ${dateTime(override.decidedAt)}`,
    verdict: override.verdict,
  };
}

function signalValue(candidate: DuplicationCandidate, kind: SignalKind): string {
  const item = candidate.evidence?.signals.find((signal) => signal.signal === kind);
  return item ? percent(item.value) : "—";
}

function sampleSize(candidate: DuplicationCandidate): number {
  return (candidate.evidence?.signals ?? []).reduce(
    (largest, signal) => Math.max(largest, signal.sampleSize),
    0,
  );
}

function sampleGap(sample: MatchSample): string {
  const left = sample.leftPublishedAt?.toDate();
  const right = sample.rightPublishedAt?.toDate();
  if (!left || !right) return "—";
  return duration(Math.abs(right.getTime() - left.getTime()) / 1000);
}

function useChannelNames(clients: Clients): (id: string) => string {
  const [channels, setChannels] = useState<Map<string, Channel>>(() => new Map());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await clients.catalog.listChannels({ page: { pageSize: PAGE_SIZE } });
        if (cancelled) return;
        const next = new Map<string, Channel>();
        for (const item of response.channels) {
          if (item.channel) next.set(item.channel.id, item.channel);
        }
        setChannels(next);
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients]);

  return useCallback(
    (id: string) => {
      const channel = channels.get(id);
      return channel ? channelName(channel) : shortId(id);
    },
    [channels],
  );
}

export function PairsScreen({ clients }: { clients: Clients }) {
  const [params, setParams] = useSearchParams();
  const snapshotId = params.get("snapshot") ?? "";

  const [candidates, setCandidates] = useState<DuplicationCandidate[]>([]);
  const [clusters, setClusters] = useState<DuplicationCluster[]>([]);
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [cluster, setCluster] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [filter, setFilter] = useState<MatchFilter>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DuplicationCandidate | undefined>();
  const [detailError, setDetailError] = useState("");
  const [detailKey, setDetailKey] = useState(0);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const nameOf = useChannelNames(clients);

  useEffect(() => {
    if (!snapshotId) {
      setCandidates([]);
      setClusters([]);
      setRunId("");
      setError("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const [candidatesResponse, clustersResponse, runsResponse] = await Promise.all([
          clients.duplication.listCandidates({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.duplication.listClusters({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.duplication.listAnalysisRuns({ snapshotId, page: { pageSize: 1 } }),
        ]);
        if (cancelled) return;
        setCandidates(candidatesResponse.candidates);
        setClusters(clustersResponse.clusters);
        setRunId(runsResponse.runs[0]?.id ?? "");
      } catch (cause) {
        if (!cancelled) setError(errorText(cause, "Не вдалося завантажити пари каналів."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, snapshotId, reloadKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      setDetailError("");
      return;
    }

    let cancelled = false;
    setDetail(undefined);
    setDetailError("");

    void (async () => {
      try {
        const response = await clients.duplication.getCandidate({ candidateId: selectedId });
        if (!cancelled) setDetail(response.candidate);
      } catch (cause) {
        if (!cancelled) setDetailError(errorText(cause, "Не вдалося завантажити пару."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, selectedId, detailKey]);

  const clusterOf = useMemo(() => {
    const map = new Map<string, DuplicationCluster>();
    for (const item of clusters) {
      for (const candidateId of item.candidateIds) map.set(candidateId, item);
    }
    return map;
  }, [clusters]);

  const rows = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (cluster && clusterOf.get(candidate.id)?.id !== cluster) return false;
        if (filter === "manual") return candidate.hasMatchOverride;
        if (filter === "auto") return !candidate.hasMatchOverride;
        return true;
      }),
    [candidates, cluster, clusterOf, filter],
  );

  const aboveThreshold = candidates.filter(
    (candidate) => candidate.confidence * 100 >= threshold,
  ).length;
  const manualCount = candidates.filter((candidate) => candidate.hasMatchOverride).length;

  const selectedIndex = rows.findIndex((candidate) => candidate.id === selectedId);
  const selected =
    detail ?? candidates.find((candidate) => candidate.id === selectedId) ?? undefined;

  const openers = useRef(new Map<string, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement>(null);

  const registerOpener = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) openers.current.set(id, element);
    else openers.current.delete(id);
  }, []);

  const latest = useRef({ rows, selectedId });
  useEffect(() => {
    latest.current = { rows, selectedId };
  });

  const close = useCallback(() => {
    const opened = latest.current.selectedId;
    setSelectedId(null);
    if (opened) openers.current.get(opened)?.focus();
  }, []);

  useEffect(() => {
    if (selectedId) panelRef.current?.focus();
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const state = latest.current;
      if (!state.selectedId) return;

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      const index = state.rows.findIndex((candidate) => candidate.id === state.selectedId);
      if (index < 0) return;
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next < 0 || next >= state.rows.length) return;

      event.preventDefault();
      setSelectedId(state.rows[next].id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const applyMatch = useCallback(
    async (action: () => Promise<{ candidate?: DuplicationCandidate }>) => {
      setBusy(true);
      setActionError("");
      try {
        const response = await action();
        const updated = response.candidate;
        if (!updated) return;
        setCandidates((current) =>
          current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        );
        setDetail((current) => (current && current.id === updated.id ? updated : current));
      } catch (cause) {
        setActionError(errorText(cause, "Не вдалося зберегти рішення щодо пари."));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const setVerdict = useCallback(
    (candidateId: string, verdict: MatchVerdict) =>
      void applyMatch(() => clients.duplication.setCandidateMatch({ candidateId, verdict })),
    [applyMatch, clients],
  );

  const resetVerdict = useCallback(
    (candidateId: string) =>
      void applyMatch(() => clients.duplication.resetCandidateMatch({ candidateId })),
    [applyMatch, clients],
  );

  return (
    <Page
      title="Пари каналів"
      summary={
        <>
          {candidates.length} пар оцінено{runId ? ` в запуску #${shortId(runId)}` : ""} ·{" "}
          {aboveThreshold} перевищують поріг · {manualCount} змінено вручну
        </>
      }
      actions={
        <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
          <SnapshotPicker
            clients={clients}
            value={snapshotId}
            onChange={(next) => {
              setSelectedId(null);
              setParams(next ? { snapshot: next } : {});
            }}
            emptyLabel="Оберіть снапшот"
          />

          <div className="field" style={{ width: 220 }}>
            <label htmlFor="pairs-cluster">Кластер</label>
            <select
              id="pairs-cluster"
              className="input"
              value={cluster}
              onChange={(event) => setCluster(event.target.value)}
            >
              <option value="">Усі кластери</option>
              {clusters.map((item) => (
                <option key={item.id} value={item.id}>
                  Кластер {shortId(item.id)} · каналів: {item.channelIds.length}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ width: 180 }}>
            <label htmlFor="pairs-threshold">Поріг збігів, %</label>
            <input
              id="pairs-threshold"
              className="input"
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
          </div>

          <div className="seg" role="group" aria-label="Показані пари" style={{ marginBottom: 0 }}>
            {(
              [
                ["all", "Усі"],
                ["auto", "Автоматичні"],
                ["manual", "Змінені вручну"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="seg-opt">
                <input
                  type="radio"
                  name="pairs-filter"
                  checked={filter === value}
                  onChange={() => setFilter(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      }
    >
      {actionError === "" ? null : (
        <p role="alert" className="card elev-sm m-0" style={{ fontSize: 13, padding: "12px 16px" }}>
          {actionError}
        </p>
      )}

      {snapshotId === "" ? (
        <Empty
          title="Снапшот не обрано"
          hint="Оберіть снапшот, щоб побачити пари каналів, оцінені його аналізом."
        />
      ) : loading ? (
        <Loading label="Завантаження пар…" />
      ) : error !== "" ? (
        <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : rows.length === 0 ? (
        <Empty
          title="Пар немає"
          hint={
            candidates.length === 0
              ? "Аналіз цього снапшоту ще не знайшов кандидатів дублювання."
              : "Жодна пара не відповідає обраному кластеру чи фільтру матчінгу."
          }
        />
      ) : (
        <table className="table">
          <caption className="sr-only">
            Пари каналів снапшоту з автоматичним і ручним матчінгом
          </caption>
          <thead>
            <tr>
              <th>Пара</th>
              <th>Кластер</th>
              <th style={{ textAlign: "right" }}>Лексика</th>
              <th style={{ textAlign: "right" }}>Посилання</th>
              <th style={{ textAlign: "right" }}>Пересилання</th>
              <th style={{ textAlign: "right" }}>Час</th>
              <th style={{ textAlign: "right" }}>Збіги</th>
              <th>Матчінг</th>
              <th style={{ width: 180 }}>Змінити</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((candidate) => (
              <PairRow
                key={candidate.id}
                candidate={candidate}
                clusterLabel={
                  clusterOf.has(candidate.id)
                    ? `Кластер ${shortId(clusterOf.get(candidate.id)!.id)}`
                    : "Поза кластерами"
                }
                threshold={threshold}
                busy={busy}
                nameOf={nameOf}
                onOpen={() => setSelectedId(candidate.id)}
                onSet={(verdict) => setVerdict(candidate.id, verdict)}
                registerOpener={registerOpener}
              />
            ))}
          </tbody>
        </table>
      )}

      <div
        className="flex items-center"
        style={{
          gap: 12,
          padding: "14px 18px",
          borderRadius: 8,
          background: "var(--color-surface)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <i className="ph ph-info" style={{ fontSize: 18, color: "var(--color-accent)" }} aria-hidden="true" />
        <p className={`m-0 ${textSoft}`} style={{ fontSize: 13 }}>
          Ручна зміна перекриває автоматичний результат до наступної зміни порогів. Рішення
          фіксується з автором і датою, метрики перерахунком не змінюються.
        </p>
      </div>

      {selected === undefined || selectedId === null ? null : (
        <PairPanel
          panelRef={panelRef}
          candidate={selected}
          loading={detail === undefined && detailError === ""}
          error={detailError}
          onRetry={() => setDetailKey((current) => current + 1)}
          clusterLabel={
            clusterOf.has(selected.id)
              ? `Кластер ${shortId(clusterOf.get(selected.id)!.id)}`
              : "Поза кластерами"
          }
          threshold={threshold}
          busy={busy}
          nameOf={nameOf}
          position={`${selectedIndex + 1} з ${rows.length}`}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex >= 0 && selectedIndex < rows.length - 1}
          onPrev={() => setSelectedId(rows[selectedIndex - 1]?.id ?? selectedId)}
          onNext={() => setSelectedId(rows[selectedIndex + 1]?.id ?? selectedId)}
          onClose={close}
          onSet={(verdict) => setVerdict(selected.id, verdict)}
          onReset={() => resetVerdict(selected.id)}
        />
      )}
    </Page>
  );
}

interface RowProps {
  candidate: DuplicationCandidate;
  clusterLabel: string;
  threshold: number;
  busy: boolean;
  nameOf: (id: string) => string;
  onOpen: () => void;
  onSet: (verdict: MatchVerdict) => void;
  registerOpener: (id: string, element: HTMLButtonElement | null) => void;
}

function PairRow({
  candidate,
  clusterLabel,
  threshold,
  busy,
  nameOf,
  onOpen,
  onSet,
  registerOpener,
}: RowProps) {
  const match = effectiveMatch(candidate);
  const title = `${nameOf(candidate.leftChannelId)} ↔ ${nameOf(candidate.rightChannelId)}`;
  const overlap = candidate.confidence * 100;

  return (
    <tr>
      <td
        style={{
          boxShadow: match.manual ? "inset 2px 0 0 0 var(--color-accent)" : undefined,
        }}
      >
        <button
          type="button"
          ref={(element) => registerOpener(candidate.id, element)}
          onClick={onOpen}
          className="flex flex-col items-start text-left"
          style={{ gap: 2, background: "transparent", border: 0, padding: 0, color: "inherit", cursor: "pointer" }}
        >
          <span style={{ fontSize: 14 }}>{title}</span>
          <span className={textFaint} style={{ fontSize: 11 }}>
            {sampleSize(candidate)} публікацій · затримка{" "}
            {candidate.evidence ? duration(candidate.evidence.medianDelaySeconds) : "—"}
          </span>
        </button>
      </td>
      <td className={textSoft}>{clusterLabel}</td>
      <td className="tabular-nums" style={{ textAlign: "right" }}>
        {signalValue(candidate, SignalKind.LEXICAL_OVERLAP)}
      </td>
      <td className="tabular-nums" style={{ textAlign: "right" }}>
        {signalValue(candidate, SignalKind.SHARED_LINKS)}
      </td>
      <td className="tabular-nums" style={{ textAlign: "right" }}>
        {signalValue(candidate, SignalKind.FORWARD)}
      </td>
      <td className="tabular-nums" style={{ textAlign: "right" }}>
        {signalValue(candidate, SignalKind.TIMING)}
      </td>
      <td
        className={overlap >= threshold ? "tabular-nums" : `tabular-nums ${textSoft}`}
        style={{ textAlign: "right", color: overlap >= threshold ? "var(--color-accent)" : undefined }}
      >
        {percent(candidate.confidence)}
      </td>
      <td>
        <div className="flex flex-col" style={{ gap: 2 }}>
          <span className={match.tagClass} style={{ alignSelf: "flex-start" }}>
            {match.label}
          </span>
          <span className={textFaint} style={{ fontSize: 11 }}>
            {match.note}
          </span>
        </div>
      </td>
      <td>
        <MatchToggle
          name={`match-${candidate.id}`}
          label={`Матчінг пари ${title}`}
          verdict={match.verdict}
          busy={busy}
          compact
          onSet={onSet}
        />
      </td>
    </tr>
  );
}

interface ToggleProps {
  name: string;
  label: string;
  verdict?: MatchVerdict;
  busy: boolean;
  compact?: boolean;
  onSet: (verdict: MatchVerdict) => void;
}

function MatchToggle({ name, label, verdict, busy, compact, onSet }: ToggleProps) {
  const padding = compact ? "5px 10px" : undefined;

  return (
    <div className="seg" role="group" aria-label={label}>
      <label className="seg-opt" style={{ padding }}>
        <input
          type="radio"
          name={name}
          disabled={busy}
          checked={verdict === MatchVerdict.DUPLICATE}
          onChange={() => onSet(MatchVerdict.DUPLICATE)}
        />
        Дубль
      </label>
      <label className="seg-opt" style={{ padding }}>
        <input
          type="radio"
          name={name}
          disabled={busy}
          checked={verdict === MatchVerdict.NOT_DUPLICATE}
          onChange={() => onSet(MatchVerdict.NOT_DUPLICATE)}
        />
        Не дубль
      </label>
    </div>
  );
}

interface PanelProps {
  panelRef: RefObject<HTMLDivElement>;
  candidate: DuplicationCandidate;
  loading: boolean;
  error: string;
  onRetry: () => void;
  clusterLabel: string;
  threshold: number;
  busy: boolean;
  nameOf: (id: string) => string;
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSet: (verdict: MatchVerdict) => void;
  onReset: () => void;
}

function PairPanel({
  panelRef,
  candidate,
  loading,
  error,
  onRetry,
  clusterLabel,
  threshold,
  busy,
  nameOf,
  position,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSet,
  onReset,
}: PanelProps) {
  const match = effectiveMatch(candidate);
  const leftName = nameOf(candidate.leftChannelId);
  const rightName = nameOf(candidate.rightChannelId);
  const evidence = candidate.evidence;
  const overlap = candidate.confidence * 100;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pair-panel-title"
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(1240px, calc(var(--app-vw) - 190px))",
        zIndex: 15,
        background: "var(--color-bg)",
        boxShadow: "var(--shadow-lg)",
        borderLeft: "1px solid var(--color-divider)",
        overflowY: "auto",
        padding: "24px 28px 40px",
        gap: 22,
      }}
    >
      <div
        className="flex flex-wrap items-start"
        style={{
          gap: 16,
          position: "sticky",
          top: -24,
          background: "var(--color-bg)",
          padding: "8px 0 12px",
          marginTop: -8,
          zIndex: 2,
        }}
      >
        <div className="flex flex-col" style={{ gap: 6 }}>
          <h4 id="pair-panel-title" className="m-0">
            {leftName} ↔ {rightName}
          </h4>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <span className="tag tag-neutral">{clusterLabel}</span>
            <span className={match.tagClass}>{match.label}</span>
            <span className={textMuted} style={{ fontSize: 12 }}>
              {match.note}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-icon btn-secondary"
          style={{ width: 32, height: 32, marginLeft: "auto" }}
          onClick={onClose}
          aria-label="Закрити панель пари"
        >
          <i className="ph ph-x" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
        <span className={textMuted} style={{ fontSize: 12 }}>
          Матчінг
        </span>
        <MatchToggle
          name={`match-panel-${candidate.id}`}
          label="Матчінг обраної пари"
          verdict={match.verdict}
          busy={busy}
          onSet={onSet}
        />
        {match.manual ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 34, fontSize: 13 }}
            disabled={busy}
            onClick={onReset}
          >
            Повернути автоматичний
          </button>
        ) : null}
        <div className="flex" style={{ gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 32, height: 32 }}
            disabled={!hasPrev}
            onClick={onPrev}
            aria-label="Попередня пара"
          >
            <i className="ph ph-caret-up" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 32, height: 32 }}
            disabled={!hasNext}
            onClick={onNext}
            aria-label="Наступна пара"
          >
            <i className="ph ph-caret-down" aria-hidden="true" />
          </button>
          <span className={textFaint} style={{ fontSize: 12, alignSelf: "center" }}>
            {position}
          </span>
        </div>
      </div>

      {error !== "" ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {loading ? <Loading label="Завантаження пари…" /> : null}

      <div className="grid" style={{ gridTemplateColumns: "1.25fr 1fr", gap: 14 }}>
        <div
          className="flex flex-col"
          style={{
            padding: "18px 20px",
            borderRadius: 8,
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-sm)",
            gap: 16,
          }}
        >
          <div className="flex items-baseline" style={{ gap: 12 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>
              Сигнали та їхній внесок
            </span>
          </div>
          <div className="flex flex-col" style={{ gap: 14 }}>
            {(evidence?.signals ?? []).map((signal) => (
              <div key={signal.signal} className="flex flex-col" style={{ gap: 6 }}>
                <div className="flex items-baseline" style={{ gap: 10, fontSize: 13 }}>
                  <span>{signalLabels[signal.signal]}</span>
                  <span
                    className="tabular-nums"
                    style={{
                      marginLeft: "auto",
                      color: "var(--color-accent)",
                      width: 56,
                      textAlign: "right",
                    }}
                  >
                    {percent(signal.value)}
                  </span>
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
                  }}
                >
                  <div
                    style={{
                      width: percentWidth(signal.value),
                      height: 4,
                      borderRadius: 2,
                      background: "var(--color-accent)",
                    }}
                  />
                </div>
                <span className={textFaint} style={{ fontSize: 11 }}>
                  {signal.explanation} Вибірка: {signal.sampleSize}.
                </span>
              </div>
            ))}
            {(evidence?.signals ?? []).length === 0 && !loading ? (
              <span className={textFaint} style={{ fontSize: 13 }}>
                Сигналів для цієї пари немає.
              </span>
            ) : null}
          </div>
          <div style={{ height: 1, background: "var(--color-divider)" }} />
          <div className="flex items-baseline" style={{ gap: 14 }}>
            <span className={textSoft} style={{ fontSize: 13 }}>
              Зважений підсумок
            </span>
            <span
              className="tabular-nums"
              style={{ fontSize: 26, fontFamily: "var(--font-heading)", color: "var(--color-accent)" }}
            >
              {percent(candidate.confidence)}
            </span>
            <span
              className={overlap >= threshold ? undefined : textFaint}
              style={{
                fontSize: 12,
                marginLeft: "auto",
                color: overlap >= threshold ? "var(--color-accent)" : undefined,
              }}
            >
              {overlap >= threshold
                ? `Перевищує поріг ${threshold}%`
                : `Нижче порогу ${threshold}%`}
            </span>
          </div>
        </div>

        <div
          className="flex flex-col"
          style={{
            padding: "18px 20px",
            borderRadius: 8,
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-sm)",
            gap: 12,
          }}
        >
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Профіль збігу</span>
          <dl className="m-0 flex flex-col" style={{ gap: 8, fontSize: 13 }}>
            <ProfileRow label="Автоматичний зв'язок" value={relationLabels[candidate.relation]} />
            <ProfileRow
              label="Частота збігів"
              value={evidence ? percent(evidence.matchRate) : "—"}
            />
            <ProfileRow
              label="Унікальне зліва"
              value={evidence ? percent(evidence.leftUniqueShare) : "—"}
            />
            <ProfileRow
              label="Унікальне справа"
              value={evidence ? percent(evidence.rightUniqueShare) : "—"}
            />
            <ProfileRow
              label="Ризик втрати"
              value={evidence ? percent(evidence.contentLossRisk) : "—"}
            />
            <ProfileRow
              label="Раніше публікує"
              value={evidence ? nameOf(evidence.earlierChannelId) : "—"}
            />
            <ProfileRow
              label="Типова затримка"
              value={evidence ? duration(evidence.medianDelaySeconds) : "—"}
            />
            <ProfileRow
              label="Достатньо даних"
              value={candidate.hasSufficientData ? "Так" : "Ні"}
            />
            <ProfileRow label="Версія алгоритму" value={candidate.algorithmVersion || "—"} />
            <ProfileRow label="Обчислено" value={dateTime(candidate.computedAt)} />
          </dl>
        </div>
      </div>

      <div className="flex" style={{ gap: 8 }}>
        <Link
          className="btn btn-secondary"
          style={{ height: 32, fontSize: 13 }}
          to={`/channels/${candidate.leftChannelId}`}
        >
          Відкрити {leftName}
        </Link>
        <Link
          className="btn btn-secondary"
          style={{ height: 32, fontSize: 13 }}
          to={`/channels/${candidate.rightChannelId}`}
        >
          Відкрити {rightName}
        </Link>
      </div>

      <Section
        title="Збіги публікацій"
        actions={
          <span className={textFaint} style={{ fontSize: 12 }}>
            Вибірка {sampleSize(candidate)} публікацій · показано {evidence?.samples.length ?? 0}
          </span>
        }
      >
        {(evidence?.samples ?? []).map((sample) => (
          <div
            key={`${sample.leftChannelId}:${sample.leftPostForeignId}-${sample.rightChannelId}:${sample.rightPostForeignId}`}
            className="flex flex-col"
            style={{
              padding: "16px 18px",
              borderRadius: 8,
              background: "var(--color-surface)",
              boxShadow: "var(--shadow-sm)",
              gap: 12,
            }}
          >
            <div className="flex items-baseline" style={{ gap: 12 }}>
              <span className={textMuted} style={{ fontSize: 12 }}>
                {dateTime(sample.leftPublishedAt)}
              </span>
              <span className={textMuted} style={{ fontSize: 12 }}>
                затримка {sampleGap(sample)}
              </span>
              <span
                className="tabular-nums"
                style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-accent)" }}
              >
                схожість {percent(sample.similarity)}
              </span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Excerpt
                who={nameOf(sample.leftChannelId)}
                at={dateTime(sample.leftPublishedAt)}
                post={sample.leftPostForeignId}
                text={sample.leftExcerpt}
              />
              <Excerpt
                who={nameOf(sample.rightChannelId)}
                at={dateTime(sample.rightPublishedAt)}
                post={sample.rightPostForeignId}
                text={sample.rightExcerpt}
              />
            </div>
          </div>
        ))}
        {(evidence?.samples ?? []).length === 0 && !loading ? (
          <span className={textFaint} style={{ fontSize: 12 }}>
            Прикладів збігів для цієї пари немає.
          </span>
        ) : null}
      </Section>

      <Section title="Історія рішень">
        {candidate.matchHistory.length === 0 ? (
          <span className={textFaint} style={{ fontSize: 12 }}>
            Ручних рішень щодо цієї пари ще не ухвалювали.
          </span>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Коли</th>
                <th style={{ width: 140 }}>Хто</th>
                <th>Подія</th>
              </tr>
            </thead>
            <tbody>
              {candidate.matchHistory.map((entry) => (
                <tr key={entry.id}>
                  <td className={`tabular-nums ${textMuted}`}>{dateTime(entry.occurredAt)}</td>
                  <td className={textSoft}>{entry.appUsername || shortId(entry.appUserId)}</td>
                  <td>{matchEventLabels[entry.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between" style={{ gap: 12 }}>
      <dt className={textSoft}>{label}</dt>
      <dd className="m-0 tabular-nums" style={{ textAlign: "right" }}>
        {value}
      </dd>
    </div>
  );
}

function Excerpt({
  who,
  at,
  post,
  text,
}: {
  who: string;
  at: string;
  post: string;
  text: string;
}) {
  return (
    <div
      className="flex flex-col"
      style={{ padding: "12px 14px", borderRadius: 8, background: "var(--color-bg)", gap: 6 }}
    >
      <div className="flex items-baseline" style={{ gap: 8 }}>
        <span className={textMuted} style={{ fontSize: 11 }}>
          {who} · {at}
        </span>
        <span className="tag tag-outline" style={{ marginLeft: "auto" }}>
          допис {post}
        </span>
      </div>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.55 }}>
        {text}
      </p>
    </div>
  );
}
