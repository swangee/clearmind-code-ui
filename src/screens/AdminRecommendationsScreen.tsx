import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { Channel } from "@clearmind/contracts/clearmind/v1/channel_pb";
import type {
  Recommendation,
  ReviewDecision,
} from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";

import { Page } from "../components/Page";
import { SnapshotPicker } from "../components/SnapshotPicker";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { channelName, dateTime, decisionLabels, percent, shortId } from "../lib/format";
import { textFaint, textMuted } from "../lib/styles";

const PAGE_SIZE = 100;

function decisionTag(decision: DecisionKind): string {
  if (decision === DecisionKind.UNSPECIFIED) return "tag tag-outline";
  if (decision === DecisionKind.CONFIRMED) return "tag tag-accent";
  return "tag tag-neutral";
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

export function AdminRecommendationsScreen({ clients }: { clients: Clients }) {
  const [params, setParams] = useSearchParams();
  const snapshotId = params.get("snapshot") ?? "";

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const nameOf = useChannelNames(clients);

  useEffect(() => {
    if (!snapshotId) {
      setRecommendations([]);
      setDecisions([]);
      setRunId("");
      setError("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const [recommendationsResponse, decisionsResponse, runsResponse] = await Promise.all([
          clients.recommendation.listRecommendations({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.recommendation.listDecisions({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.duplication.listAnalysisRuns({ snapshotId, page: { pageSize: 1 } }),
        ]);
        if (cancelled) return;
        setRecommendations(recommendationsResponse.recommendations);
        setDecisions(decisionsResponse.decisions);
        setRunId(runsResponse.runs[0]?.id ?? "");
      } catch (cause) {
        if (!cancelled) setError(errorText(cause, "Не вдалося завантажити рекомендації."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, snapshotId, reloadKey]);

  const decidedAt = useMemo(() => {
    const map = new Map<string, ReviewDecision>();
    for (const decision of decisions) {
      const known = map.get(decision.recommendationId);
      const knownAt = known?.decidedAt?.toDate().getTime() ?? 0;
      const currentAt = decision.decidedAt?.toDate().getTime() ?? 0;
      if (!known || currentAt >= knownAt) map.set(decision.recommendationId, decision);
    }
    return map;
  }, [decisions]);

  const counts = {
    confirmed: recommendations.filter((item) => item.currentDecision === DecisionKind.CONFIRMED)
      .length,
    rejected: recommendations.filter((item) => item.currentDecision === DecisionKind.REJECTED)
      .length,
    deferred: recommendations.filter((item) => item.currentDecision === DecisionKind.DEFERRED)
      .length,
    none: recommendations.filter((item) => item.currentDecision === DecisionKind.UNSPECIFIED)
      .length,
  };

  return (
    <Page
      title="Рекомендації"
      summary={
        <>
          {runId ? `Запуск #${shortId(runId)} · ` : ""}
          {recommendations.length} рекомендацій
        </>
      }
      actions={
        <div className="flex" style={{ gap: 26, marginLeft: "auto" }}>
          <Stat value={counts.confirmed} label="підтверджено" />
          <Stat value={counts.rejected} label="відхилено" />
          <Stat value={counts.deferred} label="відкладено" />
          <Stat value={counts.none} label="без рішення" />
        </div>
      }
    >
      <SnapshotPicker
        clients={clients}
        value={snapshotId}
        onChange={(next) => setParams(next ? { snapshot: next } : {})}
        emptyLabel="Оберіть снапшот"
      />

      {snapshotId === "" ? (
        <Empty
          title="Снапшот не обрано"
          hint="Оберіть снапшот, щоб побачити його рекомендації та рішення користувача."
        />
      ) : loading ? (
        <Loading label="Завантаження рекомендацій…" />
      ) : error !== "" ? (
        <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : recommendations.length === 0 ? (
        <Empty
          title="Рекомендацій немає"
          hint="Аналіз цього снапшоту не запропонував нічого зняти з підписок."
        />
      ) : (
        <table className="table">
          <caption className="sr-only">
            Рекомендації снапшоту з рішенням користувача та версією
          </caption>
          <thead>
            <tr>
              <th>Пара</th>
              <th>Рекомендовано зняти</th>
              <th style={{ textAlign: "right" }}>Збіги</th>
              <th style={{ textAlign: "right" }}>Ризик втрати</th>
              <th>Рішення користувача</th>
              <th style={{ textAlign: "right" }}>Версія</th>
              <th>Оновлено</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((item) => {
              const decision = decidedAt.get(item.id);
              return (
                <tr key={item.id}>
                  <td>
                    {nameOf(item.referenceChannelId)} ↔ {nameOf(item.subjectChannelId)}
                  </td>
                  <td>{nameOf(item.subjectChannelId)}</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {item.evidence ? percent(item.evidence.matchRate) : "—"}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {item.evidence ? percent(item.evidence.contentLossRisk) : "—"}
                  </td>
                  <td>
                    <span className={decisionTag(item.currentDecision)}>
                      {decisionLabels[item.currentDecision]}
                    </span>
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {String(item.version)}
                  </td>
                  <td className={textMuted}>
                    {dateTime(decision?.decidedAt ?? item.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className={`m-0 ${textFaint}`} style={{ fontSize: 12 }}>
        Рекомендація перегенеровується з новою версією після кожного запуску. Рішення користувача
        зберігається за версією, з якою його ухвалили.
      </p>
    </Page>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span
        className="tabular-nums"
        style={{ fontSize: 22, fontFamily: "var(--font-heading)" }}
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
