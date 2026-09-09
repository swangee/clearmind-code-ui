import { useCallback, useEffect, useState } from "react";

import type { Timestamp } from "@bufbuild/protobuf";

import type {
  Recommendation,
  ReviewDecision,
} from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import type { Subscription } from "@clearmind/contracts/clearmind/v1/subscription_pb";

import { EvidencePanel } from "../components/EvidencePanel";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { dateTime, decisionLabels, percent, shortId, signalLabels } from "../lib/format";
import {
  alert,
  primaryButton,
  quietButton,
  secondaryButton,
  tagAccent,
  tagNeutral,
  tagOutline,
  textFaint,
  textMuted,
  textSoft,
} from "../lib/styles";

interface Props {
  clients: Clients;
  snapshotId: string;
}

const surface = {
  borderRadius: 8,
  background: "var(--color-surface)",
  boxShadow: "var(--shadow-sm)",
} as const;

const action = { height: 34, fontSize: 13 } as const;

const LOSS_RISK_WARNING = 0.25;

type Tab = "active" | "confirmed" | "rejected";

const TABS: { id: Tab; label: string }[] = [
  { id: "active", label: "Активні" },
  { id: "confirmed", label: "Виконані" },
  { id: "rejected", label: "Відхилені" },
];

function tabOf(decision: DecisionKind): Tab {
  if (decision === DecisionKind.CONFIRMED) return "confirmed";
  if (decision === DecisionKind.REJECTED) return "rejected";
  return "active";
}

function channelHandle(member: Subscription | undefined, channelId: string): string {
  if (member?.username) return `@${member.username}`;
  if (member?.title) return member.title;
  return shortId(channelId);
}

function indexDecisions(decisions: ReviewDecision[]): Map<string, ReviewDecision> {
  const latest = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    const known = latest.get(decision.recommendationId);
    if (!known || decision.recommendationVersion >= known.recommendationVersion) {
      latest.set(decision.recommendationId, decision);
    }
  }
  return latest;
}

interface SnapshotContext {
  members: Map<string, Subscription>;
  frozenAt?: Timestamp;
}

const NO_CONTEXT: SnapshotContext = { members: new Map() };

export function RecommendationsScreen({ clients, snapshotId }: Props) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [decisions, setDecisions] = useState<Map<string, ReviewDecision>>(() => new Map());
  const [context, setContext] = useState<SnapshotContext>(NO_CONTEXT);
  const [tab, setTab] = useState<Tab>("active");
  const [expanded, setExpanded] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    if (!snapshotId) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await clients.recommendation.listRecommendations({ snapshotId });
      setRecommendations(response.recommendations);
    } catch (cause) {
      setLoadError(errorText(cause, "Не вдалося завантажити рекомендації."));
    } finally {
      setLoading(false);
    }
  }, [clients, snapshotId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!snapshotId) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const [snapshot, decided] = await Promise.allSettled([
          clients.subscription.getSnapshot({ snapshotId }),
          clients.recommendation.listDecisions({ snapshotId }),
        ]);
        if (cancelled) return;

        if (snapshot.status === "fulfilled") {
          setContext({
            members: new Map(snapshot.value.members.map((member) => [member.channelId, member])),
            frozenAt: snapshot.value.snapshot?.frozenAt,
          });
        }
        if (decided.status === "fulfilled") {
          setDecisions(indexDecisions(decided.value.decisions));
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, snapshotId]);

  async function decide(recommendation: Recommendation, decision: DecisionKind) {
    setBusyId(recommendation.id);
    setActionError("");
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

      const record = response.decision;
      if (record) {
        setDecisions((current) => new Map(current).set(record.recommendationId, record));
      }
    } catch (cause) {
      setActionError(errorText(cause, "Не вдалося зберегти рішення."));
    } finally {
      setBusyId("");
    }
  }

  const counts: Record<Tab, number> = { active: 0, confirmed: 0, rejected: 0 };
  for (const item of recommendations) counts[tabOf(item.currentDecision)] += 1;
  const visible = recommendations.filter((item) => tabOf(item.currentDecision) === tab);

  return (
    <div className="grid w-full gap-7 lg:grid-cols-[1.55fr_1fr]">
      <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="recommendations-heading" className="m-0" style={{ fontSize: 25 }}>
              Що варто переглянути
            </h2>
            <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
              {counts.active} рекомендацій
              {context.frozenAt ? ` · снапшот заморожено ${dateTime(context.frozenAt)}` : ""}
            </p>
          </div>

          <div
            className="seg"
            role="radiogroup"
            aria-label="Стан рекомендацій"
            style={{ marginLeft: "auto" }}
          >
            {TABS.map((option) => (
              <label key={option.id} className="seg-opt">
                <input
                  type="radio"
                  name="recommendation-state"
                  value={option.id}
                  checked={tab === option.id}
                  onChange={() => setTab(option.id)}
                />
                {option.label} {counts[option.id]}
              </label>
            ))}
          </div>
        </div>

        {actionError === "" ? null : (
          <p role="alert" className={alert} style={{ padding: "12px 16px" }}>
            {actionError}
          </p>
        )}

        {loadError === "" ? null : <ErrorState message={loadError} onRetry={() => void load()} />}

        {loading && recommendations.length === 0 ? (
          <Loading label="Завантаження рекомендацій…" />
        ) : null}

        {!loading && loadError === "" && visible.length === 0 ? (
          <Empty
            title="Тут поки порожньо"
            hint={
              tab === "active"
                ? "Активних рекомендацій за цим снапшотом немає."
                : "Рішення з'являться в цьому розділі, щойно ви їх ухвалите."
            }
          />
        ) : null}

        {visible.map((item) => {
          const subject = channelHandle(context.members.get(item.subjectChannelId), item.subjectChannelId);
          const reference = channelHandle(
            context.members.get(item.referenceChannelId),
            item.referenceChannelId,
          );
          const busy = busyId === item.id;

          if (tabOf(item.currentDecision) !== "active") {
            const confirmed = item.currentDecision === DecisionKind.CONFIRMED;
            const decidedAt = decisions.get(item.id)?.decidedAt;

            return (
              <article
                key={item.id}
                className="flex flex-wrap items-center gap-3.5"
                style={{ ...surface, padding: "16px 20px", opacity: 0.7 }}
              >
                <i
                  className={confirmed ? "ph ph-check-circle" : `ph ph-x-circle ${textFaint}`}
                  aria-hidden="true"
                  style={{ fontSize: 18, color: confirmed ? "var(--color-accent)" : undefined }}
                />
                <div className="flex flex-col">
                  <span style={{ fontSize: 14 }}>Зняти {subject}</span>
                  <span className={textMuted} style={{ fontSize: 12 }}>
                    {decisionLabels[item.currentDecision]}
                    {decidedAt ? ` · ${dateTime(decidedAt)}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item, DecisionKind.DEFERRED)}
                  className={quietButton}
                  style={{ marginLeft: "auto", height: 32, fontSize: 13 }}
                >
                  Повернути
                </button>
              </article>
            );
          }

          const evidence = item.evidence;
          const isOpen = expanded === item.id;

          return (
            <article
              key={item.id}
              className="flex flex-col gap-3.5"
              style={{ ...surface, padding: "18px 20px" }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>
                  Зняти {subject}
                </span>
                {evidence ? (
                  <span className={tagAccent}>{percent(evidence.matchRate)} збігів</span>
                ) : null}
                {item.currentDecision === DecisionKind.DEFERRED ? (
                  <span className={tagNeutral}>Відкладено</span>
                ) : null}
                <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
                  Лишається {reference}
                </span>
              </div>

              <p className="m-0" style={{ fontSize: 14, lineHeight: 1.55 }}>
                {item.rationale}
              </p>

              {evidence && evidence.signals.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {evidence.signals.map((signal) => (
                    <span key={signal.signal} className={tagOutline}>
                      {signalLabels[signal.signal]} {percent(signal.value)}
                    </span>
                  ))}
                </div>
              ) : null}

              {evidence && evidence.contentLossRisk >= LOSS_RISK_WARNING ? (
                <div
                  className="flex items-center gap-2.5"
                  style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-bg)" }}
                >
                  <i
                    className="ph ph-warning"
                    aria-hidden="true"
                    style={{ fontSize: 16, color: "var(--color-accent)" }}
                  />
                  <span className={textSoft} style={{ fontSize: 13 }}>
                    Ризик втрати вищий за середній — перегляньте унікальні дописи перед рішенням
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item, DecisionKind.CONFIRMED)}
                  className={primaryButton}
                  style={action}
                >
                  Підтвердити
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item, DecisionKind.REJECTED)}
                  className={secondaryButton}
                  style={action}
                >
                  Відхилити
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(item, DecisionKind.DEFERRED)}
                  className={quietButton}
                  style={action}
                >
                  Відкласти
                </button>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? "" : item.id)}
                  className={quietButton}
                  style={{ ...action, marginLeft: "auto" }}
                >
                  Докази та втрати
                </button>
              </div>

              {isOpen && evidence ? <EvidencePanel evidence={evidence} /> : null}
            </article>
          );
        })}

        <p className={`m-0 ${textFaint}`} style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 820 }}>
          Рішення зберігається у ClearMind і не змінює ваших підписок. Відписка від каналів
          виконується вручну в Telegram.
        </p>
      </section>

      <aside aria-labelledby="hygiene-heading" className="flex flex-col gap-3.5">
        <h3 id="hygiene-heading" className="m-0" style={{ fontSize: 16 }}>
          Гігієна підписок
        </h3>
        <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
          Стосується структури стрічки загалом, а не окремих каналів.
        </p>

        {context.members.size === 0 ? null : (
          <div className="card elev-sm">
            <span className="card-kicker">Обсяг снапшоту</span>
            <span className="card-title">{context.members.size} каналів</span>
            <p className="card-body">
              Рекомендації описують саме цей склад підписок. Наступний снапшот перерахує їх заново.
            </p>
          </div>
        )}

        <div className="card elev-sm">
          <span className="card-kicker">Дублювання за призначенням</span>
          <span className="card-title">Тривоги залишені осторонь</span>
          <p className="card-body">
            Канали сповіщень навмисно дублюють одне одного — високий збіг для них очікуваний і сам
            собою не привід їх знімати.
          </p>
        </div>

        <div className="card elev-sm">
          <span className="card-kicker">Ритм перегляду</span>
          <span className="card-title">Повертайтесь раз на місяць</span>
          <p className="card-body">
            Склад каналів змінюється: сьогоднішній унікальний канал за півроку може стати
            ретранслятором.
          </p>
        </div>
      </aside>
    </div>
  );
}
