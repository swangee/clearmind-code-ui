import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import type { CatalogChannel, ChannelAddedEvent } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { ChannelStatus } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";
import type { DuplicationCandidate } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import { MatchVerdict } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { SubscriptionSnapshot } from "@clearmind/contracts/clearmind/v1/subscription_pb";

import { ChannelCharacteristics } from "../components/ChannelCharacteristics";
import { Page, Section } from "../components/Page";
import { AnalysisRunCard, IngestionRunCard } from "../components/RunCards";
import { Empty, ErrorState, Loading } from "../components/States";
import { useRunLauncher } from "../hooks/useRunLauncher";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import {
  channelAddedSourceLabels,
  channelName,
  channelStatusLabels,
  channelStatusTag,
  dateTime,
  duration,
  matchVerdictLabels,
  percent,
  relationLabels,
  shortId,
  socialMediaLabels,
} from "../lib/format";
import { textFaint, textMuted, textSoft } from "../lib/styles";
import { RemoveChannelDialog } from "./ChannelCatalogScreen";

interface Props {
  clients: Clients;
  isAdmin: boolean;
  pollIntervalMs?: number;
}

function latestSnapshot(snapshots: SubscriptionSnapshot[]): SubscriptionSnapshot | undefined {
  return snapshots.reduce<SubscriptionSnapshot | undefined>((latest, snapshot) => {
    if (!latest) return snapshot;
    const current = snapshot.frozenAt?.seconds ?? 0n;
    const best = latest.frozenAt?.seconds ?? 0n;
    return current > best ? snapshot : latest;
  }, undefined);
}

export function ChannelDetailScreen({ clients, isAdmin, pollIntervalMs }: Props) {
  const { channelId = "" } = useParams();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<CatalogChannel | undefined>();
  const [candidates, setCandidates] = useState<DuplicationCandidate[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [events, setEvents] = useState<ChannelAddedEvent[]>([]);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [candidatesNote, setCandidatesNote] = useState("");
  const [eventsNote, setEventsNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [runSnapshotId, setRunSnapshotId] = useState("");
  const runs = useRunLauncher(clients, pollIntervalMs);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await clients.catalog.getChannel({ channelId });
        if (!cancelled) setChannel(response.channel);
      } catch (cause) {
        if (!cancelled) setError(errorText(cause, "Каналу немає в каталозі."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, channelId, reloadKey]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshots = await clients.subscription.listSnapshots({ page: { pageSize: 50 } });
        const snapshot = latestSnapshot(snapshots.snapshots);
        if (!snapshot) {
          if (!cancelled) setCandidatesNote("Жодного снапшоту ще немає.");
          return;
        }

        const response = await clients.duplication.listCandidates({ snapshotId: snapshot.id });
        if (cancelled) return;
        setSnapshotId(snapshot.id);
        setCandidates(
          response.candidates.filter(
            (candidate) =>
              candidate.leftChannelId === channelId || candidate.rightChannelId === channelId,
          ),
        );
      } catch (cause) {
        if (!cancelled) setCandidatesNote(errorText(cause, "Не вдалося завантажити кандидатів."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, channelId]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const response = await clients.catalog.listChannelAddedEvents({
          channelId,
          page: { pageSize: 50 },
        });
        if (!cancelled) setEvents(response.events);
      } catch (cause) {
        if (!cancelled) setEventsNote(errorText(cause, "Не вдалося завантажити історію."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, channelId, isAdmin]);

  if (error) {
    return (
      <Page>
        <ErrorState
          message={error}
          onRetry={() => {
            setError("");
            setReloadKey((current) => current + 1);
          }}
        />
        <Link to="/catalog" style={{ fontSize: 13 }}>
          До каталогу каналів
        </Link>
      </Page>
    );
  }

  const identity = channel?.channel;
  const handle = identity?.username ? `@${identity.username}` : identity?.foreignId || "";
  const status = channel?.status ?? ChannelStatus.UNSPECIFIED;
  const paused = status === ChannelStatus.PAUSED;
  const profile = channel?.hasProfile ? channel.profile : undefined;

  async function setPaused(next: boolean) {
    if (!channel) return;
    setBusy(true);
    setActionError("");
    try {
      const response = next
        ? await clients.catalog.pauseChannel({ channelId })
        : await clients.catalog.resumeChannel({ channelId });
      setChannel(response.channel);
    } catch (cause) {
      setActionError(
        errorText(cause, next ? "Не вдалося поставити канал на паузу." : "Не вдалося відновити канал."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function recollect() {
    setBusy(true);
    setActionError("");
    try {
      const response = await clients.subscription.createSnapshot({
        memberChannelIds: [channelId],
      });
      const created = response.snapshot?.id ?? "";
      setRunSnapshotId(created);
      if (created) await runs.runPipeline(created, 30);
    } catch (cause) {
      setActionError(errorText(cause, "Не вдалося запустити перезбір."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      breadcrumb={
        <div className={`flex items-center ${textMuted}`} style={{ gap: 8, fontSize: 13 }}>
          <Link to="/catalog">Каталог каналів</Link>
          <i className="ph ph-caret-right" style={{ fontSize: 11 }} aria-hidden="true" />
          <span>{handle || shortId(channelId)}</span>
        </div>
      }
      title={channelName(identity)}
      summary={
        <>
          {handle || "—"} · у каталозі з {dateTime(channel?.addedAt)}{" "}
          <span className={channelStatusTag(status)}>{channelStatusLabels[status]}</span>
        </>
      }
      actions={
        isAdmin && channel ? (
          <div className="flex flex-wrap" style={{ gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: 34, fontSize: 13 }}
              disabled={busy || runs.busy}
              onClick={() => void recollect()}
            >
              <i className="ph ph-arrows-clockwise" aria-hidden="true" />
              Перезібрати
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: 34, fontSize: 13 }}
              disabled={busy}
              onClick={() => void setPaused(!paused)}
            >
              <i className={paused ? "ph ph-play" : "ph ph-pause"} aria-hidden="true" />
              {paused ? "Відновити" : "Поставити на паузу"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: 34, fontSize: 13 }}
              onClick={() => setRemoveOpen(true)}
            >
              <i className="ph ph-trash" aria-hidden="true" />
              Видалити
            </button>
          </div>
        ) : undefined
      }
    >
      {actionError && (
        <p role="alert" className="card elev-sm text-sm" style={{ padding: "12px 14px" }}>
          {actionError}
        </p>
      )}

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
        <div className="card elev-sm" style={{ padding: "18px 20px", gap: 14 }}>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Стан імпорту</span>
            <span className={profile ? "tag tag-neutral" : "tag tag-outline"}>
              {profile ? "Проаналізовано" : "Аналіз не завершено"}
            </span>
            {profile && (
              <span className={textFaint} style={{ marginLeft: "auto", fontSize: 12 }}>
                Остання публікація {dateTime(profile.lastPostAt)}
              </span>
            )}
          </div>
          {channel ? (
            <ChannelCharacteristics channel={channel} pendingLabel="ще не проаналізовано" />
          ) : (
            <Loading label="Завантаження каналу…" />
          )}
        </div>

        <div className="card elev-sm" style={{ padding: "18px 20px", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 17 }}>Дані каналу</span>
          <dl className="m-0 flex flex-col" style={{ gap: 8, fontSize: 13 }}>
            <Fact label="Платформа">
              {socialMediaLabels[identity?.socialMediaType ?? SocialMediaType.UNSPECIFIED]}
            </Fact>
            <Fact label="ID у платформі">{identity?.foreignId || "—"}</Fact>
            <Fact label="У каталозі з">{dateTime(channel?.addedAt)}</Fact>
            <Fact label="Перша публікація">{dateTime(profile?.firstPostAt)}</Fact>
            <Fact label="Остання публікація">{dateTime(profile?.lastPostAt)}</Fact>
          </dl>
        </div>
      </div>

      {runSnapshotId && (
        <div className="flex flex-col" style={{ gap: 12 }}>
          {runs.error && (
            <p role="alert" className="card elev-sm text-sm" style={{ padding: "12px 14px" }}>
              {runs.error}
            </p>
          )}
          {runs.ingestion && <IngestionRunCard run={runs.ingestion} />}
          {runs.analysis && <AnalysisRunCard run={runs.analysis} />}
        </div>
      )}

      <Section
        title="Схожі канали"
        actions={
          <>
            <span className={textFaint} style={{ fontSize: 12 }}>
              Пари, у яких бере участь цей канал
            </span>
            {snapshotId && (
              <Link to="/pairs" style={{ fontSize: 13 }}>
                Відкрити в розділі «Пари»
              </Link>
            )}
          </>
        }
      >
        {candidatesNote ? (
          <Empty title={candidatesNote} />
        ) : candidates.length === 0 ? (
          <Empty
            title="Кандидатів для цього каналу немає."
            hint="Пари зʼявляться після аналізу снапшоту, що містить цей канал."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Канал</th>
                <th>Відношення</th>
                <th style={{ textAlign: "right" }}>Впевненість</th>
                <th style={{ textAlign: "right" }}>Збіги</th>
                <th style={{ textAlign: "right" }}>Затримка</th>
                <th>Матчінг</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => {
                const otherId =
                  candidate.leftChannelId === channelId
                    ? candidate.rightChannelId
                    : candidate.leftChannelId;
                const verdict = candidate.hasMatchOverride
                  ? candidate.matchOverride?.verdict ?? MatchVerdict.UNSPECIFIED
                  : MatchVerdict.UNSPECIFIED;
                return (
                  <tr key={candidate.id}>
                    <td>
                      <Link to={`/channels/${otherId}`}>Канал {shortId(otherId)}</Link>
                    </td>
                    <td className={textMuted}>{relationLabels[candidate.relation]}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {percent(candidate.confidence)}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {candidate.evidence ? percent(candidate.evidence.matchRate) : "—"}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {candidate.evidence ? duration(candidate.evidence.medianDelaySeconds) : "—"}
                    </td>
                    <td>
                      <span
                        className={
                          candidate.hasMatchOverride ? "tag tag-accent" : "tag tag-neutral"
                        }
                      >
                        {matchVerdictLabels[verdict]}
                      </span>
                      {!candidate.hasSufficientData && (
                        <span className={textFaint} style={{ marginLeft: 8, fontSize: 12 }}>
                          даних недостатньо
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {isAdmin && (
        <Section
          title="Історія додавання"
          actions={
            <span className={textFaint} style={{ fontSize: 12 }}>
              Як канал потрапив до каталогу
            </span>
          }
        >
          {eventsNote ? (
            <Empty title={eventsNote} />
          ) : events.length === 0 ? (
            <Empty title="Записів про додавання немає." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Коли</th>
                  <th>Джерело</th>
                  <th>Ініціатор</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className={textMuted}>{dateTime(event.occurredAt)}</td>
                    <td>{channelAddedSourceLabels[event.source]}</td>
                    <td>{event.appUsername || event.appUserId || "без ініціатора"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {removeOpen && channel && (
        <RemoveChannelDialog
          clients={clients}
          channel={channel}
          onClose={() => setRemoveOpen(false)}
          onPaused={(updated) => {
            if (updated) setChannel(updated);
            setRemoveOpen(false);
          }}
          onRemoved={() => {
            setRemoveOpen(false);
            navigate("/catalog");
          }}
        />
      )}
    </Page>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between" style={{ gap: 12 }}>
      <dt className={textSoft}>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}
