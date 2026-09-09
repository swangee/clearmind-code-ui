import { useCallback, useEffect, useMemo, useState } from "react";

import type { CatalogChannel } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { RunStatus } from "@clearmind/contracts/clearmind/v1/common_pb";
import type {
  AnalysisRun,
  DuplicationCandidate,
  DuplicationCluster,
  EvidenceBundle,
  UniquePost,
} from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { RelationKind, SignalKind } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";
import type { Recommendation } from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import type { SubscriptionSnapshot } from "@clearmind/contracts/clearmind/v1/subscription_pb";

import { Page, Section } from "../components/Page";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import {
  channelName,
  collectionCoverage,
  dateTime,
  decisionLabels,
  duration,
  fmtInt,
  haltedStage,
  isRunFinished,
  percent,
  percentWidth,
  pluralForm,
  processingStages,
  relationLabels,
  runFailureLabels,
  shortId,
  signalLabels,
  type StageOutcome,
} from "../lib/format";
import { textFaint, textMuted, textSoft } from "../lib/styles";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const LOSS_PAGE_SIZE = 5;

type View = "clusters" | "pairs";
type Sort = "overlap" | "channel";

interface PairView {
  candidate: DuplicationCandidate;
  evidence?: EvidenceBundle;
  leftName: string;
  rightName: string;
  leftMeta: string;
  rightMeta: string;
  dropId: string;
  dropName: string;
  dropUniqueShare: number;
  recommendation?: Recommendation;
  groupLabel: string;
}

interface LossView {
  channelId: string;
  posts: UniquePost[];
  totalCount: number;
}

export function ReviewScreen({ clients }: { clients: Clients }) {
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | undefined>(undefined);
  const [candidates, setCandidates] = useState<DuplicationCandidate[]>([]);
  const [clusters, setClusters] = useState<DuplicationCluster[]>([]);
  const [channels, setChannels] = useState<CatalogChannel[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [ingestionRun, setIngestionRun] = useState<IngestionRun | undefined>(
    undefined,
  );
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [view, setView] = useState<View>("clusters");
  const [sort, setSort] = useState<Sort>("overlap");
  const [collapsedClusters, setCollapsedClusters] = useState<ReadonlySet<string>>(new Set());
  const [openPairs, setOpenPairs] = useState<ReadonlySet<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DuplicationCandidate>>({});
  const [losses, setLosses] = useState<Record<string, LossView>>({});
  const [windowDays, setWindowDays] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState("");
  const [decisionError, setDecisionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const snapshots = await clients.subscription.listSnapshots({ page: { pageSize: 50 } });
      const latest = latestSnapshot(snapshots.snapshots);
      setSnapshot(latest);

      if (!latest) {
        setCandidates([]);
        setClusters([]);
        setRecommendations([]);
        setIngestionRun(undefined);
        setAnalysisRun(undefined);
        return;
      }

      const collectionWindow = async () => {
        try {
          const response = await clients.analysisSettings.getAnalysisSettings({});
          return response.settings?.collectionWindowDays ?? 0;
        } catch {
          return 0;
        }
      };

      const lastIngestion = async () => {
        try {
          const response = await clients.ingestion.listIngestionRuns({
            snapshotId: latest.id,
            page: { pageSize: 1 },
          });
          return response.runs?.[0];
        } catch {
          return undefined;
        }
      };
      const lastAnalysis = async () => {
        try {
          const response = await clients.duplication.listAnalysisRuns({
            snapshotId: latest.id,
            page: { pageSize: 1 },
          });
          return response.runs?.[0];
        } catch {
          return undefined;
        }
      };

      const [
        candidateList,
        clusterList,
        channelList,
        recommendationList,
        days,
        collected,
        analysed,
      ] = await Promise.all([
        collectPages(async (pageToken) => {
          const response = await clients.duplication.listCandidates({
            snapshotId: latest.id,
            page: { pageSize: PAGE_SIZE, pageToken },
          });
          return {
            items: response.candidates ?? [],
            nextPageToken: response.page?.nextPageToken ?? "",
          };
        }),
        collectPages(async (pageToken) => {
          const response = await clients.duplication.listClusters({
            snapshotId: latest.id,
            page: { pageSize: PAGE_SIZE, pageToken },
          });
          return {
            items: response.clusters ?? [],
            nextPageToken: response.page?.nextPageToken ?? "",
          };
        }),
        collectPages(async (pageToken) => {
          const response = await clients.catalog.listChannels({
            page: { pageSize: PAGE_SIZE, pageToken },
          });
          return {
            items: response.channels ?? [],
            nextPageToken: response.page?.nextPageToken ?? "",
          };
        }),
        collectPages(async (pageToken) => {
          const response = await clients.recommendation.listRecommendations({
            snapshotId: latest.id,
            page: { pageSize: PAGE_SIZE, pageToken },
          });
          return {
            items: response.recommendations ?? [],
            nextPageToken: response.page?.nextPageToken ?? "",
          };
        }),
        collectionWindow(),
        lastIngestion(),
        lastAnalysis(),
      ]);

      setCandidates(candidateList.items);
      setClusters(clusterList.items);
      setChannels(channelList.items);
      setRecommendations(recommendationList.items);
      setTruncated(
        !candidateList.complete ||
          !clusterList.complete ||
          !channelList.complete ||
          !recommendationList.complete,
      );
      setWindowDays(days);
      setIngestionRun(collected);
      setAnalysisRun(analysed);
      setDetails({});
      setLosses({});
    } catch (cause) {
      setLoadError(errorText(cause, "Не вдалося завантажити ревізію."));
    } finally {
      setLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    void load();
  }, [load]);

  const pairs = useMemo(() => {
    const byId = new Map(channels.map((item) => [item.channel?.id ?? "", item]));
    const byCandidate = new Map(recommendations.map((item) => [item.candidateId, item]));
    const groups = new Map<string, string>();
    clusters.forEach((cluster, index) => {
      for (const candidateId of cluster.candidateIds ?? []) {
        groups.set(candidateId, `Група ${index + 1}`);
      }
    });

    return candidates.map((listed) => {
      const candidate = details[listed.id] ?? listed;
      const evidence = candidate.evidence;
      const recommendation = byCandidate.get(candidate.id);
      const dropId = proposedForRemoval(candidate, recommendation);
      const isLeftDropped = dropId === candidate.leftChannelId;

      return {
        candidate,
        evidence,
        leftName: nameOf(byId.get(candidate.leftChannelId), candidate.leftChannelId),
        rightName: nameOf(byId.get(candidate.rightChannelId), candidate.rightChannelId),
        leftMeta: metaOf(byId.get(candidate.leftChannelId)),
        rightMeta: metaOf(byId.get(candidate.rightChannelId)),
        dropId,
        dropName: nameOf(byId.get(dropId), dropId),
        dropUniqueShare: isLeftDropped
          ? (evidence?.leftUniqueShare ?? 0)
          : (evidence?.rightUniqueShare ?? 0),
        recommendation,
        groupLabel: groups.get(candidate.id) ?? "Поза групами",
      } satisfies PairView;
    });
  }, [candidates, channels, clusters, details, recommendations]);

  const sortedPairs = useMemo(() => {
    const copy = [...pairs];
    if (sort === "channel") {
      copy.sort((a, b) =>
        `${a.leftName} ${a.rightName}`.localeCompare(`${b.leftName} ${b.rightName}`, "uk"),
      );
    } else {
      copy.sort((a, b) => (b.evidence?.matchRate ?? 0) - (a.evidence?.matchRate ?? 0));
    }
    return copy;
  }, [pairs, sort]);

  const grouped = useMemo(() => groupByCluster(clusters, pairs), [clusters, pairs]);

  const insufficient = pairs.filter((pair) => !pair.candidate.hasSufficientData).length;
  const duplicating = pairs.filter(
    (pair) =>
      pair.candidate.relation === RelationKind.PERSISTENT_DUPLICATION ||
      pair.candidate.relation === RelationKind.PARTIAL_OVERLAP,
  ).length;
  const paired = new Set<string>();
  for (const pair of pairs) {
    paired.add(pair.candidate.leftChannelId);
    paired.add(pair.candidate.rightChannelId);
  }
  const unpaired = channels.filter((item) => !paired.has(item.channel?.id ?? ""));
  const withoutContent = unpaired.filter((item) => !item.hasProfile).length;
  const quiet = unpaired.length;

  async function togglePair(pair: PairView) {
    const candidateId = pair.candidate.id;
    const isOpen = openPairs.has(candidateId);
    setOpenPairs((current) => toggled(current, candidateId));
    if (isOpen) return;

    await Promise.all([
      loadCandidate(candidateId),
      loadLoss(candidateId, removable(pair) ? pair.dropId : ""),
    ]);
  }

  async function loadCandidate(candidateId: string) {
    if (details[candidateId]) return;
    try {
      const response = await clients.duplication.getCandidate({ candidateId });
      if (response.candidate) {
        const fresh = response.candidate;
        setDetails((current) => ({ ...current, [candidateId]: fresh }));
      }
    } catch {
    }
  }

  async function loadLoss(candidateId: string, channelId: string) {
    if (channelId === "" || losses[candidateId]?.channelId === channelId) return;
    try {
      const response = await clients.duplication.listUniquePosts({
        candidateId,
        channelId,
        page: { pageSize: LOSS_PAGE_SIZE },
      });
      const loaded: LossView = {
        channelId,
        posts: response.posts ?? [],
        totalCount: response.totalCount,
      };
      setLosses((current) => ({ ...current, [candidateId]: loaded }));
    } catch {
    }
  }

  async function decide(pair: PairView, decision: DecisionKind) {
    const recommendation = pair.recommendation;
    if (!recommendation) return;

    setBusyId(pair.candidate.id);
    setDecisionError("");
    try {
      const response = await clients.recommendation.submitDecision({
        recommendationId: recommendation.id,
        recommendationVersion: recommendation.version,
        decision,
      });
      const updated = response.recommendation;
      if (updated) {
        setRecommendations((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      setReopened((current) => without(current, pair.candidate.id));
    } catch (cause) {
      setDecisionError(errorText(cause, "Не вдалося зберегти рішення."));
    } finally {
      setBusyId("");
    }
  }

  const boundary = (
    <p className={`m-0 ${textFaint}`} style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 820 }}>
      Схожість контенту не доводить комерційного чи пропагандистського наміру. ClearMind не виконує
      фактчекінг, не визначає власників каналів і не відписує від них автоматично.
    </p>
  );

  return (
    <Page
      title="Ревізія підписок"
      summary={
        loading
          ? "Читаємо останній снапшот…"
          : snapshot
            ? `Снапшот від ${dateTime(snapshot.frozenAt)} · ${shortId(snapshot.id)}`
            : "Снапшот ще не створено"
      }
      actions={
        loading || loadError !== "" ? null : (
          <div style={{ display: "flex", gap: 28, marginLeft: "auto" }}>
            <Stat value={fmtInt(snapshot?.memberCount ?? 0)} label="каналів" />
            <Stat value={fmtInt(duplicating)} label="пар із дублюванням" />
            <Stat value={fmtInt(insufficient)} label="пар без достатніх даних" accent />
          </div>
        )
      }
    >
      {loading ? (
        <Loading label="Завантаження ревізії…" />
      ) : loadError !== "" ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !snapshot ? (
        <Empty
          title="Снапшот підписок ще не створено."
          hint="Ревізія спирається на заморожений склад підписок: спершу імпортуйте підписки й створіть снапшот."
        />
      ) : pairs.length === 0 ? (
        <Empty
          {...emptyReason(ingestionRun, analysisRun)}
          action={
            <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => void load()}>
              Оновити
            </button>
          }
        />
      ) : (
        <Section
          title="Знайдене дублювання"
          actions={
            <>
              <span className={textFaint} style={{ fontSize: 12 }}>
                {truncated ? "щонайменше " : ""}
                {fmtInt(pairs.length)} пар оцінено · {fmtInt(duplicating)} із дублюванням
              </span>
              <div className="seg">
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="review-view"
                    checked={view === "clusters"}
                    onChange={() => setView("clusters")}
                  />
                  За тематикою
                </label>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="review-view"
                    checked={view === "pairs"}
                    onChange={() => setView("pairs")}
                  />
                  Усі пари підряд
                </label>
              </div>
            </>
          }
        >
          {decisionError === "" ? null : (
            <div role="alert" className="card elev-sm" style={{ padding: "12px 14px" }}>
              <span style={{ fontSize: 13 }}>{decisionError}</span>
            </div>
          )}

          {view === "pairs" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
                  Усі пари з дублюванням. Група показана як позначка, але порядок від неї не
                  залежить.
                </p>
                <div className="seg" style={{ marginLeft: "auto" }}>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="review-sort"
                      checked={sort === "overlap"}
                      onChange={() => setSort("overlap")}
                    />
                    За часткою збігів
                  </label>
                  <label className="seg-opt">
                    <input
                      type="radio"
                      name="review-sort"
                      checked={sort === "channel"}
                      onChange={() => setSort("channel")}
                    />
                    За назвою каналу
                  </label>
                </div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Пара каналів</th>
                    <th>Група</th>
                    <th>Що збігається</th>
                    <th style={{ textAlign: "right" }}>Затримка</th>
                    <th style={{ textAlign: "right" }}>Унікального</th>
                    <th style={{ textAlign: "right" }}>Збіги</th>
                    <th style={{ width: 150 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPairs.map((pair) => (
                    <tr key={pair.candidate.id}>
                      <td>
                        {pair.leftName} ↔ {pair.rightName}
                      </td>
                      <td>
                        <span className="tag tag-neutral">{pair.groupLabel}</span>
                      </td>
                      <td className={textSoft}>{matchedOn(pair.evidence)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {duration(pair.evidence?.medianDelaySeconds ?? 0)}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {percent(pair.dropUniqueShare)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: "right", color: "var(--color-accent)" }}
                      >
                        {percent(pair.evidence?.matchRate ?? 0)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 13 }}
                          aria-expanded={openPairs.has(pair.candidate.id)}
                          onClick={() => void togglePair(pair)}
                        >
                          {openPairs.has(pair.candidate.id) ? "Сховати докази" : "Докази"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sortedPairs
                  .filter((pair) => openPairs.has(pair.candidate.id))
                  .map((pair) => (
                    <PairPanel
                      key={pair.candidate.id}
                      pair={pair}
                      loss={losses[pair.candidate.id]}
                      windowDays={windowDays}
                      busy={busyId === pair.candidate.id}
                      reopened={reopened.has(pair.candidate.id)}
                      onToggle={() => void togglePair(pair)}
                      onDecide={(decision) => void decide(pair, decision)}
                      onReopen={() => setReopened((current) => toggled(current, pair.candidate.id))}
                    />
                  ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
                Канали згруповані за спільним дублюванням; пари шукаються всередині групи.
              </p>

              {grouped.map((group) => {
                const open = !collapsedClusters.has(group.id);
                return (
                  <div
                    key={group.id}
                    style={{
                      borderRadius: 8,
                      background: "var(--color-surface)",
                      boxShadow: "var(--shadow-sm)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setCollapsedClusters((current) => toggled(current, group.id))
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 18px",
                        width: "100%",
                        background: "transparent",
                        border: 0,
                        color: "var(--color-text)",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                      }}
                    >
                      <i
                        className={
                          open ? "ph ph-caret-down" : `ph ph-caret-right ${textFaint}`
                        }
                        style={{ fontSize: 14, color: open ? "var(--color-accent)" : undefined }}
                        aria-hidden="true"
                      />
                      <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>
                        {group.title}
                      </span>
                      <span className="tag tag-neutral">{group.channelCount} каналів</span>
                      <span className="tag tag-accent">{group.pairs.length} пар</span>
                      <span className={textMuted} style={{ marginLeft: "auto", fontSize: 13 }}>
                        {group.note}
                      </span>
                    </button>

                    {!open ? null : (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {group.pairs.map((pair) =>
                          openPairs.has(pair.candidate.id) ? (
                            <div key={pair.candidate.id} style={{ margin: "0 12px 12px" }}>
                              <PairPanel
                                pair={pair}
                                loss={losses[pair.candidate.id]}
                                windowDays={windowDays}
                                busy={busyId === pair.candidate.id}
                                reopened={reopened.has(pair.candidate.id)}
                                onToggle={() => void togglePair(pair)}
                                onDecide={(decision) => void decide(pair, decision)}
                                onReopen={() =>
                                  setReopened((current) => toggled(current, pair.candidate.id))
                                }
                              />
                            </div>
                          ) : (
                            <button
                              key={pair.candidate.id}
                              type="button"
                              aria-expanded={false}
                              onClick={() => void togglePair(pair)}
                              style={{
                                margin: "0 12px 12px",
                                borderRadius: 8,
                                background: "var(--color-bg)",
                                boxShadow: "var(--shadow-sm)",
                                display: "flex",
                                alignItems: "center",
                                gap: 16,
                                padding: "14px 20px",
                                border: 0,
                                color: "var(--color-text)",
                                cursor: "pointer",
                                textAlign: "left",
                                font: "inherit",
                              }}
                            >
                              <i
                                className={`ph ph-caret-right ${textFaint}`}
                                style={{ fontSize: 14 }}
                                aria-hidden="true"
                              />
                              <span style={{ fontSize: 14 }}>{pair.leftName}</span>
                              <i
                                className={`ph ph-arrows-left-right ${textFaint}`}
                                style={{ fontSize: 14 }}
                                aria-hidden="true"
                              />
                              <span style={{ fontSize: 14 }}>{pair.rightName}</span>
                              <span className={textMuted} style={{ fontSize: 12 }}>
                                {shortNote(pair)}
                              </span>
                              <span
                                className="tabular-nums"
                                style={{
                                  marginLeft: "auto",
                                  fontSize: 14,
                                  color: "var(--color-accent)",
                                }}
                              >
                                {percent(pair.evidence?.matchRate ?? 0)}
                              </span>
                              <span className="btn btn-ghost" style={{ fontSize: 13 }}>
                                Показати докази
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {quiet === 0 ? null : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 18px",
                    borderRadius: 8,
                    background: "var(--color-surface)",
                    boxShadow: "var(--shadow-sm)",
                    opacity: 0.65,
                  }}
                >
                  <i
                    className={`ph ph-minus ${textFaint}`}
                    style={{ fontSize: 14 }}
                    aria-hidden="true"
                  />
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>
                    Не порівнювалися
                  </span>
                  <span className="tag tag-neutral">{fmtInt(quiet)} каналів</span>
                  <span className={textMuted} style={{ marginLeft: "auto", fontSize: 13 }}>
                    {unpairedNote(quiet, withoutContent)}
                  </span>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {boundary}
    </Page>
  );
}

function emptyReason(
  ingestion?: IngestionRun,
  analysis?: AnalysisRun,
): { title: string; note?: string; hint: string } {
  if (analysis?.status === RunStatus.SUCCEEDED) {
    return {
      title: "Жодна пара каналів не має стійкого збігу.",
      note: collectionGapNote(ingestion),
      hint: "Аналіз дійшов до кінця: серед каналів, які потрапили в порівняння, немає пари, що стійко повторює іншу.",
    };
  }

  const halted = haltedStage(processingStages(ingestion, analysis));
  if (halted) {
    return {
      title:
        halted.status === RunStatus.PARTIAL
          ? "Снапшот оброблено не повністю."
          : "Снапшот не оброблено.",
      hint: `${haltedHint(halted)} Дублювання для цього снапшоту не рахувалося.`,
    };
  }

  if (analysis !== undefined && !isRunFinished(analysis.status)) {
    return {
      title: "Аналіз снапшоту ще триває.",
      hint: "Розділ наповниться, щойно запуск дійде до кінця — оновіть його за хвилину.",
    };
  }

  return {
    title: "Аналіз цього снапшоту ще не виконувався.",
    hint: "Ревізія спирається на результат обробки: запустіть її в розділі «Імпорт підписок».",
  };
}

function collectionGapNote(ingestion?: IngestionRun): string | undefined {
  if (!ingestion) return undefined;

  const coverage = collectionCoverage(ingestion);
  if (coverage) {
    if (coverage.total <= 0 || coverage.delivered >= coverage.total) return undefined;
    const entered = pluralForm(coverage.delivered, ["увійшов", "увійшли", "увійшло"]);
    const channel = pluralForm(coverage.delivered, ["канал", "канали", "каналів"]);
    return `У порівняння ${entered} ${fmtInt(coverage.delivered)} ${channel} із ${fmtInt(
      coverage.total,
    )} — збір завершився частково.`;
  }

  if (ingestion.status === RunStatus.PARTIAL) {
    return "Збір завершився частково — у порівняння увійшли не всі канали снапшоту.";
  }
  if (ingestion.status === RunStatus.FAILED || ingestion.status === RunStatus.CANCELLED) {
    return "Збір не дійшов до кінця — у порівняння увійшли не всі канали снапшоту.";
  }
  return undefined;
}

function haltedHint(stage: StageOutcome): string {
  const what =
    stage.status === RunStatus.CANCELLED
      ? `Етап «${stage.title}» скасовано.`
      : stage.status === RunStatus.PARTIAL
        ? `Етап «${stage.title}» завершився частково.`
        : `Етап «${stage.title}» не вдався.`;
  if (!stage.failure) return what;
  return `${what} ${runFailureLabels[stage.failure.code]}${
    stage.failure.message ? `: ${stage.failure.message}` : "."
  }`;
}

function PairPanel({
  pair,
  loss,
  windowDays,
  busy,
  reopened,
  onToggle,
  onDecide,
  onReopen,
}: {
  pair: PairView;
  loss?: LossView;
  windowDays: number;
  busy: boolean;
  reopened: boolean;
  onToggle: () => void;
  onDecide: (decision: DecisionKind) => void;
  onReopen: () => void;
}) {
  const { candidate, evidence, recommendation } = pair;
  const sufficient = candidate.hasSufficientData;
  const sample = evidence?.samples?.[0];
  const moreSamples = Math.max((evidence?.samples?.length ?? 0) - 1, 0);
  const decision = recommendation?.currentDecision ?? DecisionKind.UNSPECIFIED;
  const decided = decision !== DecisionKind.UNSPECIFIED && !reopened;
  const canRemove = removable(pair);
  const lossPosts = loss?.channelId === pair.dropId ? loss.posts : [];
  const attributed = evidence?.attributed ?? [];
  const lexicalSampleSize =
    evidence?.signals?.find((signal) => signal.signal === SignalKind.LEXICAL_OVERLAP)
      ?.sampleSize ?? 0;

  return (
    <div style={{ borderRadius: 8, background: "var(--color-bg)", boxShadow: "var(--shadow-sm)" }}>
      <div
        style={{
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
          <button
            type="button"
            aria-expanded
            onClick={onToggle}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flex: 1,
              background: "transparent",
              border: 0,
              padding: 0,
              color: "var(--color-text)",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
            }}
          >
            <i
              className="ph ph-caret-down"
              style={{ fontSize: 14, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15 }}>{pair.leftName}</span>
              <span className={textMuted} style={{ fontSize: 12 }}>
                {pair.leftMeta}
              </span>
            </span>
            <i
              className="ph ph-arrows-left-right"
              style={{ fontSize: 16, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15 }}>{pair.rightName}</span>
              <span className={textMuted} style={{ fontSize: 12 }}>
                {pair.rightMeta}
              </span>
            </span>
          </button>
          <div style={{ textAlign: "right" }}>
            <div
              className="tabular-nums"
              style={{
                fontSize: 22,
                fontFamily: "var(--font-heading)",
                color: "var(--color-accent)",
              }}
            >
              {percent(evidence?.matchRate ?? 0)}
            </div>
            <div
              className={textFaint}
              style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              публікацій збігаються
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="tag tag-outline">{relationLabels[candidate.relation]}</span>
          {sufficient ? (
            <span className="tag tag-neutral">Впевненість {percent(candidate.confidence)}</span>
          ) : (
            <span className="tag tag-neutral">Впевненість не остаточна</span>
          )}
        </div>

        <p className="m-0" style={{ fontSize: 14, lineHeight: 1.55, maxWidth: 820 }}>
          {recommendation?.rationale ||
            `Пари ${pair.leftName} і ${pair.rightName} збігаються за окремими сигналами; кожен із них показано нижче роздільно.`}
        </p>

        {sufficient ? null : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--color-surface)",
            }}
          >
            <i
              className="ph ph-warning-circle"
              style={{ fontSize: 17, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 13 }}>
              Даних для цієї пари недостатньо: числова впевненість не подається як остаточна, і пара
              не пропонується до зняття.
            </span>
          </div>
        )}

        {attributed.map((entry) => {
          const isLeft = entry.channelId === candidate.leftChannelId;
          const repeaterName = isLeft ? pair.leftName : pair.rightName;
          const pairedName = isLeft ? pair.rightName : pair.leftName;
          return (
            <div
              key={entry.channelId}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 8,
                background: "var(--color-surface)",
              }}
            >
              <i
                className="ph ph-arrow-bend-up-right"
                style={{ fontSize: 18, color: "var(--color-accent)" }}
                aria-hidden="true"
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--color-accent)",
                    }}
                  >
                    Відкрите пересилання
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ fontSize: 15, color: "var(--color-accent)" }}
                  >
                    {fmtInt(entry.attributedCount)} із {fmtInt(entry.postCount)} публікацій —{" "}
                    {percent(entry.share)}
                  </span>
                </div>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    maxWidth: 420,
                    background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
                  }}
                >
                  <div
                    style={{
                      width: percentWidth(entry.share),
                      height: 3,
                      borderRadius: 2,
                      background: "var(--color-accent)",
                    }}
                  />
                </div>
                <span style={{ fontSize: 13 }}>
                  Публікації «{repeaterName}» — оголошені репости з «{pairedName}»: джерело
                  вказане в самих публікаціях.
                </span>
              </div>
            </div>
          );
        })}

        <section
          aria-label="Сигнали прихованого копіювання"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h6 className={`m-0 ${textSoft}`}>Сигнали прихованого копіювання</h6>
            {attributed.length > 0 && lexicalSampleSize === 0 ? (
              <span className={textFaint} style={{ fontSize: 11 }}>
                Для цієї пари прихованого копіювання не виявлено — нулі нижче справжні.
              </span>
            ) : null}
          </div>
          {(evidence?.signals?.length ?? 0) === 0 ? (
            <span className={textFaint} style={{ fontSize: 13 }}>
              Сигналів немає.
            </span>
          ) : (
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}
            >
              {evidence?.signals.map((signal) => (
                <div
                  key={signal.signal}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{signalLabels[signal.signal]}</span>
                    <span className="tabular-nums" style={{ color: "var(--color-accent)" }}>
                      {percent(signal.value)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 3,
                      borderRadius: 2,
                      background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
                    }}
                  >
                    <div
                      style={{
                        width: percentWidth(signal.value),
                        height: 3,
                        borderRadius: 2,
                        background: "var(--color-accent)",
                      }}
                    />
                  </div>
                  <span className={textFaint} style={{ fontSize: 11 }}>
                    {signal.explanation} Вибірка: {fmtInt(signal.sampleSize)}.
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div
          className={textSoft}
          style={{ display: "flex", gap: 24, fontSize: 12, flexWrap: "wrap" }}
        >
          <span>Раніше публікує {earlierName(pair)}</span>
          <span>Типова затримка: {duration(evidence?.medianDelaySeconds ?? 0)}</span>
          <span>
            Унікальне: {pair.leftName} — {percent(evidence?.leftUniqueShare ?? 0)}, {pair.rightName}{" "}
            — {percent(evidence?.rightUniqueShare ?? 0)}
          </span>
        </div>

        <div className="hr" style={{ margin: 0 }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h6 className={`m-0 ${textSoft}`}>Приклад збігу</h6>
            {!sample ? (
              <span className={textFaint} style={{ fontSize: 13 }}>
                Прикладів немає.
              </span>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Excerpt
                    who={pair.leftName}
                    when={dateTime(sample.leftPublishedAt)}
                    post={sample.leftPostForeignId}
                    text={sample.leftExcerpt}
                    attributed={sample.attributed}
                  />
                  <Excerpt
                    who={pair.rightName}
                    when={dateTime(sample.rightPublishedAt)}
                    post={sample.rightPostForeignId}
                    text={sample.rightExcerpt}
                  />
                </div>
                <span className={textFaint} style={{ fontSize: 11 }}>
                  {sample.attributed ? "Джерело вказане в самій публікації" : (
                    <>Схожість {percent(sample.similarity)}</>
                  )}
                  {moreSamples === 0 ? "" : ` · ще ${fmtInt(moreSamples)} таких збігів`}
                </span>
              </>
            )}
          </section>

          {!canRemove ? null : (
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h6 className="m-0" style={{ color: "var(--color-accent)" }}>
                Це ви втратите, якщо відпишетесь від {pair.dropName}
              </h6>
              {lossPosts.length === 0 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                    <span>
                      {percent(pair.dropUniqueShare)} публікацій цього каналу не мають відповідника
                      в парному — саме вони зникнуть із стрічки.
                    </span>
                    <span>
                      Оцінка ризику втрати унікального контенту:{" "}
                      {percent(evidence?.contentLossRisk ?? 0)}.
                    </span>
                  </div>
                  <span className={textFaint} style={{ fontSize: 11 }}>
                    Частка рахується за вікном збору цього снапшоту.
                  </span>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {lossPosts.map((post) => (
                      <div
                        key={`${post.channelId}-${post.postForeignId}`}
                        style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5 }}
                      >
                        <span
                          className={textFaint}
                          style={{ fontSize: 11, whiteSpace: "nowrap", paddingTop: 2 }}
                        >
                          {dateTime(post.publishedAt)}
                        </span>
                        <span>{post.excerpt}</span>
                      </div>
                    ))}
                  </div>
                  <span className={textFaint} style={{ fontSize: 11 }}>
                    {fmtInt(loss?.totalCount ?? 0)} унікальних публікацій{" "}
                    {windowDays > 0 ? `за ${fmtInt(windowDays)} днів` : "за вікно збору снапшоту"}
                  </span>
                </>
              )}
            </section>
          )}
        </div>

        {!canRemove ? (
          <span className={textFaint} style={{ fontSize: 12 }}>
            {sufficient
              ? "Рекомендації для цієї пари ще немає — рішення стане доступним після її формування."
              : "Рішення для пари з недостатніми даними не пропонується."}
          </span>
        ) : decided ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--color-surface)",
            }}
          >
            <i
              className="ph ph-check-circle"
              style={{ fontSize: 17, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 13 }}>{decisionLabels[decision]}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: "auto", height: 32, fontSize: 13 }}
              onClick={onReopen}
            >
              Змінити рішення
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 36, whiteSpace: "nowrap" }}
              disabled={busy}
              onClick={() => onDecide(DecisionKind.CONFIRMED)}
            >
              Відписатись від {pair.dropName}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: 36 }}
              disabled={busy}
              onClick={() => onDecide(DecisionKind.REJECTED)}
            >
              Залишити обидва
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 36 }}
              disabled={busy}
              onClick={() => onDecide(DecisionKind.DEFERRED)}
            >
              Відкласти
            </button>
            <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
              Рішення зберігається в ClearMind. Відписка виконується вручну в Telegram.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Excerpt({
  who,
  when,
  post,
  text,
  attributed,
}: {
  who: string;
  when: string;
  post: string;
  text: string;
  attributed?: boolean;
}) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-surface)" }}>
      <div className={textFaint} style={{ fontSize: 11, marginBottom: 4 }}>
        {who} · {when} · допис {post}
        {attributed ? (
          <>
            {" · "}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "var(--color-accent)",
              }}
            >
              <i
                className="ph ph-arrow-bend-up-right"
                style={{ fontSize: 11 }}
                aria-hidden="true"
              />
              оголошене пересилання
            </span>
          </>
        ) : null}
      </div>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        className="tabular-nums"
        style={{
          fontSize: 26,
          fontFamily: "var(--font-heading)",
          color: accent ? "var(--color-accent)" : undefined,
        }}
      >
        {value}
      </span>
      <span
        className={textFaint}
        style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        {label}
      </span>
    </div>
  );
}

interface ClusterGroup {
  id: string;
  title: string;
  channelCount: number;
  note: string;
  pairs: PairView[];
}

function groupByCluster(clusters: DuplicationCluster[], pairs: PairView[]): ClusterGroup[] {
  const byId = new Map(pairs.map((pair) => [pair.candidate.id, pair]));
  const claimed = new Set<string>();
  const claimedChannels = new Set(clusters.flatMap((cluster) => cluster.channelIds ?? []));

  const groups = clusters.map((cluster, index) => {
    const members = (cluster.candidateIds ?? [])
      .map((candidateId) => {
        claimed.add(candidateId);
        return byId.get(candidateId);
      })
      .filter((pair): pair is PairView => pair !== undefined);

    return {
      id: cluster.id,
      title: `Група ${index + 1}`,
      channelCount: cluster.channelIds?.length ?? 0,
      note: noteFor(members),
      pairs: members,
    } satisfies ClusterGroup;
  });

  const leftovers = pairs.filter((pair) => !claimed.has(pair.candidate.id));
  if (leftovers.length > 0) {
    groups.push({
      id: "ungrouped",
      title: "Поза групами",
      channelCount: new Set(
        leftovers
          .flatMap((pair) => [pair.candidate.leftChannelId, pair.candidate.rightChannelId])
          .filter((channelId) => !claimedChannels.has(channelId)),
      ).size,
      note: noteFor(leftovers),
      pairs: leftovers,
    });
  }

  return groups;
}

function unpairedNote(total: number, withoutContent: number): string {
  if (withoutContent === 0) return "Не увійшли в жодну пару";
  if (withoutContent === total) return "Немає публікацій за вікно збору";
  return `${fmtInt(withoutContent)} без публікацій за вікно збору`;
}

function noteFor(pairs: PairView[]): string {
  const insufficient = pairs.filter((pair) => !pair.candidate.hasSufficientData).length;
  if (pairs.length === 0) return "Пар не знайдено";
  if (insufficient === 0) return "Дані повні для всіх пар";
  return `${fmtInt(insufficient)} пар без достатніх даних`;
}

function matchedOn(evidence?: EvidenceBundle): string {
  const signals = [...(evidence?.signals ?? [])].sort((a, b) => b.value - a.value).slice(0, 2);
  if (signals.length === 0) return "—";
  return signals.map((signal) => signalLabels[signal.signal].toLowerCase()).join(", ");
}

function removable(pair: PairView): boolean {
  return (
    pair.candidate.hasSufficientData && pair.recommendation !== undefined && pair.dropId !== ""
  );
}

function shortNote(pair: PairView): string {
  return pair.candidate.hasSufficientData
    ? relationLabels[pair.candidate.relation]
    : "Недостатньо даних";
}

function earlierName(pair: PairView): string {
  const earlier = pair.evidence?.earlierChannelId ?? "";
  if (earlier === pair.candidate.leftChannelId) return pair.leftName;
  if (earlier === pair.candidate.rightChannelId) return pair.rightName;
  return "не встановлено";
}

function proposedForRemoval(
  candidate: DuplicationCandidate,
  recommendation?: Recommendation,
): string {
  if (recommendation?.subjectChannelId) return recommendation.subjectChannelId;

  const earlier = candidate.evidence?.earlierChannelId ?? "";
  if (earlier === candidate.leftChannelId) return candidate.rightChannelId;
  if (earlier === candidate.rightChannelId) return candidate.leftChannelId;
  return "";
}

function nameOf(entry: CatalogChannel | undefined, fallbackId: string): string {
  if (entry?.channel) return channelName(entry.channel);
  return fallbackId === "" ? "Канал не вказано" : `Канал ${shortId(fallbackId)}`;
}

function metaOf(entry: CatalogChannel | undefined): string {
  if (!entry?.channel) return "";
  const handle = entry.channel.username ? `@${entry.channel.username}` : shortId(entry.channel.id);
  const posts = entry.hasProfile && entry.profile ? entry.profile.postCount : undefined;
  return posts === undefined ? handle : `${handle} · ${fmtInt(posts)} публікацій`;
}

async function collectPages<T>(
  fetchPage: (pageToken: string) => Promise<{ items: T[]; nextPageToken: string }>,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchPage(pageToken);
    items.push(...response.items);
    if (response.nextPageToken === "") return { items, complete: true };
    pageToken = response.nextPageToken;
  }

  return { items, complete: false };
}

function latestSnapshot(snapshots: SubscriptionSnapshot[]): SubscriptionSnapshot | undefined {
  return [...(snapshots ?? [])].sort(
    (a, b) => Number(b.frozenAt?.seconds ?? 0n) - Number(a.frozenAt?.seconds ?? 0n),
  )[0];
}

function toggled(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function without(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(id);
  return next;
}
