import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { Code, ConnectError } from "@connectrpc/connect";

import type {
  CatalogChannel,
  ImportChannelResult,
  ImportSource,
} from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { ChannelStatus } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import { SocialMediaType } from "@clearmind/contracts/clearmind/v1/common_pb";

import { ChannelCharacteristics } from "../components/ChannelCharacteristics";
import { Page, Section } from "../components/Page";
import { AnalysisRunCard, IngestionRunCard } from "../components/RunCards";
import { Empty, ErrorState, Loading } from "../components/States";
import { useRunLauncher } from "../hooks/useRunLauncher";
import type { Clients } from "../lib/clients";
import { channelErrorText, errorText, importFromSourceErrorText } from "../lib/errors";
import {
  channelName,
  channelStatusLabels,
  channelStatusTag,
  dateTime,
  fmtInt,
  importChannelOutcomeLabels,
  socialMediaLabels,
} from "../lib/format";
import { textFaint, textMuted, textSoft } from "../lib/styles";

interface Props {
  clients: Clients;
  isAdmin: boolean;
  pollIntervalMs?: number;
}

const PAGE_SIZE = 20;
const DEFAULT_WINDOW_DAYS = 30;

const IMPORT_COUNT_MIN = 1;
const IMPORT_COUNT_MAX = 100;
const DEFAULT_IMPORT_COUNT = 20;

type StatusFilter = "all" | "active" | "paused" | "error";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Усі" },
  { value: "active", label: "Активні" },
  { value: "paused", label: "Пауза" },
  { value: "error", label: "З помилками" },
];

function channelHandle(item?: CatalogChannel): string {
  const channel = item?.channel;
  if (!channel) return "—";
  return channel.username ? `@${channel.username}` : channel.foreignId;
}

function confirmationTarget(item?: CatalogChannel): string {
  return item?.channel?.username || item?.channel?.foreignId || "";
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function matchesQuery(item: CatalogChannel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    item.channel?.title ?? "",
    item.channel?.username ?? "",
    item.channel?.foreignId ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle.replace(/^@/, ""));
}

function matchesStatus(item: CatalogChannel, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return item.status === ChannelStatus.ACTIVE;
  if (filter === "paused") return item.status === ChannelStatus.PAUSED;
  return item.status === ChannelStatus.ERROR;
}

function removeErrorText(cause: unknown): string {
  const error = ConnectError.from(cause);
  if (error.code === Code.InvalidArgument) {
    return "Підтвердження не збігається з username каналу. Канал лишається в каталозі.";
  }
  return errorText(cause, "Не вдалося видалити канал.");
}

export function ChannelCatalogScreen({ clients, isAdmin, pollIntervalMs }: Props) {
  const [channels, setChannels] = useState<CatalogChannel[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshotId, setSnapshotId] = useState("");
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [removing, setRemoving] = useState<CatalogChannel | undefined>();
  const runs = useRunLauncher(clients, pollIntervalMs);
  const searchId = useId();
  const windowId = useId();

  const load = useCallback(
    async (pageToken: string) => {
      setLoadError("");
      setLoading(true);
      try {
        const response = await clients.catalog.listChannels({
          page: { pageSize: PAGE_SIZE, pageToken },
        });
        setChannels((current) =>
          pageToken ? [...current, ...response.channels] : response.channels,
        );
        setNextPageToken(response.page?.nextPageToken ?? "");
      } catch (cause) {
        setLoadError(errorText(cause, "Не вдалося завантажити каталог."));
      } finally {
        setLoading(false);
      }
    },
    [clients],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const visible = channels.filter(
    (item) => matchesQuery(item, query) && matchesStatus(item, statusFilter),
  );

  const toggle = (channelId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(channelId);
      else next.delete(channelId);
      return next;
    });

  const replace = (updated?: CatalogChannel) => {
    if (!updated?.channel?.id) return;
    setChannels((current) =>
      current.map((item) => (item.channel?.id === updated.channel?.id ? updated : item)),
    );
  };

  async function setPaused(item: CatalogChannel, paused: boolean) {
    const channelId = item.channel?.id ?? "";
    if (!channelId) return;
    setPendingId(channelId);
    setError("");
    try {
      const response = paused
        ? await clients.catalog.pauseChannel({ channelId })
        : await clients.catalog.resumeChannel({ channelId });
      replace(response.channel);
    } catch (cause) {
      setError(
        errorText(cause, paused ? "Не вдалося поставити канал на паузу." : "Не вдалося відновити канал."),
      );
    } finally {
      setPendingId("");
    }
  }

  function forget(channelId: string) {
    setChannels((current) => current.filter((item) => item.channel?.id !== channelId));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(channelId);
      return next;
    });
  }

  async function launch() {
    setBusy(true);
    setError("");
    try {
      const response = await clients.subscription.createSnapshot({
        memberChannelIds: [...selected],
      });
      const created = response.snapshot?.id ?? "";
      setSnapshotId(created);
      if (created) await runs.runPipeline(created, windowDays);
    } catch (cause) {
      setError(errorText(cause, "Не вдалося запустити збір і аналіз."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Каталог каналів"
      summary={
        <>
          Канали лишаються в каталозі незалежно від складу підписок акаунтів.{" "}
          {fmtInt(channels.length)} каналів завантажено
        </>
      }
      actions={
        isAdmin && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 36, marginLeft: "auto" }}
            aria-expanded={addOpen}
            onClick={() => setAddOpen((current) => !current)}
          >
            <i className="ph ph-plus" aria-hidden="true" />
            Додати канал
          </button>
        )
      }
    >
      {isAdmin && addOpen && (
        <AddChannelForm clients={clients} onAdded={() => void load("")} />
      )}

      <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
        <div className="field" style={{ width: 280 }}>
          <label htmlFor={searchId} className="sr-only">
            Пошук за назвою або @username
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            placeholder="Пошук за назвою або @username"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="seg" role="radiogroup" aria-label="Стан каналу">
          {statusFilters.map((option) => (
            <label key={option.value} className="seg-opt">
              <input
                type="radio"
                name="catalog-status"
                checked={statusFilter === option.value}
                onChange={() => setStatusFilter(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <span className={textMuted} style={{ marginLeft: "auto", fontSize: 13 }}>
          Показано {fmtInt(visible.length)} із {fmtInt(channels.length)}
        </span>
      </div>

      {error && (
        <p role="alert" className="card elev-sm text-sm" style={{ padding: "12px 14px" }}>
          {error}
        </p>
      )}

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load("")} />
      ) : loading && channels.length === 0 ? (
        <Loading label="Завантаження каталогу…" />
      ) : channels.length === 0 ? (
        <Empty
          title="Каталог порожній."
          hint="Канали потрапляють сюди з імпорту підписок або додаються вручну."
        />
      ) : visible.length === 0 ? (
        <Empty title="Нічого не знайдено." hint="Змініть пошуковий рядок або фільтр стану." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <span className="sr-only">Вибір</span>
              </th>
              <th>Канал</th>
              <th>Характеристики</th>
              <th>Остання публікація</th>
              <th>Статус</th>
              {isAdmin && (
                <th style={{ width: 90 }}>
                  <span className="sr-only">Дії</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const channelId = item.channel?.id ?? "";
              const name = channelName(item.channel);
              const paused = item.status === ChannelStatus.PAUSED;
              return (
                <tr key={channelId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Вибрати «${name}»`}
                      checked={selected.has(channelId)}
                      onChange={(event) => toggle(channelId, event.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                  </td>
                  <td>
                    <div className="flex flex-col">
                      <Link to={`/channels/${channelId}`}>{name}</Link>
                      <span className={textMuted} style={{ fontSize: 12 }}>
                        {socialMediaLabels[item.channel?.socialMediaType ?? SocialMediaType.UNSPECIFIED]}
                        {" · "}
                        {channelHandle(item)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <ChannelCharacteristics channel={item} />
                  </td>
                  <td className={textMuted}>{dateTime(item.profile?.lastPostAt)}</td>
                  <td>
                    <span className={channelStatusTag(item.status)}>
                      {channelStatusLabels[item.status]}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex justify-end" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-icon btn-secondary"
                          style={{ width: 30, height: 30 }}
                          disabled={pendingId === channelId}
                          aria-label={
                            paused ? `Відновити «${name}»` : `Поставити «${name}» на паузу`
                          }
                          onClick={() => void setPaused(item, !paused)}
                        >
                          <i className={paused ? "ph ph-play" : "ph ph-pause"} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon btn-secondary"
                          style={{ width: 30, height: 30 }}
                          aria-label={`Видалити «${name}»`}
                          onClick={() => setRemoving(item)}
                        >
                          <i className="ph ph-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {nextPageToken && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: "flex-start", height: 34 }}
          disabled={loading}
          onClick={() => void load(nextPageToken)}
        >
          Показати ще
        </button>
      )}

      {isAdmin && (
        <div className="card elev-sm" style={{ padding: "16px 18px" }}>
          <Section title="Імпорт із зовнішнього джерела">
            <ImportFromSourceForm clients={clients} onDone={() => void load("")} />
          </Section>
        </div>
      )}

      <div className="card elev-sm" style={{ padding: "16px 18px" }}>
        <Section title="Збір і аналіз">
          <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
            <div className="field" style={{ width: 150 }}>
              <label htmlFor={windowId}>Вікно збору, днів</label>
              <input
                id={windowId}
                className="input"
                type="number"
                min={1}
                value={windowDays}
                onChange={(event) => setWindowDays(Number(event.target.value))}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 36 }}
              disabled={busy || runs.busy || selected.size === 0}
              onClick={() => void launch()}
            >
              Запустити збір і аналіз
            </button>
            <span className={textMuted} style={{ fontSize: 13 }}>
              Вибрано каналів: {selected.size}
            </span>
          </div>
        </Section>
      </div>

      {runs.error && (
        <p role="alert" className="card elev-sm text-sm" style={{ padding: "12px 14px" }}>
          {runs.error}
        </p>
      )}

      {snapshotId && (
        <div className="flex flex-col" style={{ gap: 12 }}>
          <p className={`m-0 ${textFaint}`} style={{ fontSize: 12 }}>
            Снапшот: {snapshotId}
          </p>
          {runs.ingestion && <IngestionRunCard run={runs.ingestion} />}
          {runs.analysis && <AnalysisRunCard run={runs.analysis} />}
        </div>
      )}

      {removing && (
        <RemoveChannelDialog
          clients={clients}
          channel={removing}
          onClose={() => setRemoving(undefined)}
          onPaused={(updated) => {
            replace(updated);
            setRemoving(undefined);
          }}
          onRemoved={(channelId) => {
            forget(channelId);
            setRemoving(undefined);
          }}
        />
      )}
    </Page>
  );
}

type Identifier = "username" | "foreignId";

function AddChannelForm({ clients, onAdded }: { clients: Clients; onAdded: () => void }) {
  const [platform, setPlatform] = useState<SocialMediaType>(SocialMediaType.TELEGRAM);
  const [identifier, setIdentifier] = useState<Identifier>("username");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const platformId = useId();
  const identifierId = useId();
  const valueId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await clients.catalog.addChannel({
        socialMediaType: platform,
        username: identifier === "username" ? value.replace(/^@/, "") : "",
        foreignId: identifier === "foreignId" ? value : "",
      });
      setNote(`Канал «${channelName(response.channel?.channel)}» у каталозі.`);
      setValue("");
      onAdded();
    } catch (cause) {
      setError(channelErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="card elev-sm"
      style={{ padding: "16px 18px", gap: 12 }}
      aria-label="Додати канал"
    >
      <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
        <div className="field" style={{ width: 190 }}>
          <label htmlFor={platformId}>Платформа</label>
          <select
            id={platformId}
            className="input"
            value={String(platform)}
            onChange={(event) => setPlatform(Number(event.target.value) as SocialMediaType)}
          >
            <option value={String(SocialMediaType.TELEGRAM)}>
              {socialMediaLabels[SocialMediaType.TELEGRAM]}
            </option>
          </select>
        </div>

        <div className="field" style={{ width: 190 }}>
          <label htmlFor={identifierId}>Ідентифікатор</label>
          <select
            id={identifierId}
            className="input"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value as Identifier)}
          >
            <option value="username">Username</option>
            <option value="foreignId">ID у платформі</option>
          </select>
        </div>

        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor={valueId}>
            {identifier === "username" ? "Username каналу" : "ID каналу в платформі"}
          </label>
          <input
            id={valueId}
            className="input"
            placeholder={identifier === "username" ? "@ekonomika_ua" : "200000001"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ height: 36 }} disabled={busy || !value}>
          Додати
        </button>
      </div>

      {error && (
        <p role="alert" className="m-0" style={{ fontSize: 13 }}>
          {error}
        </p>
      )}
      {note && (
        <p className="m-0" style={{ fontSize: 13, color: "var(--color-accent)" }}>
          {note}
        </p>
      )}
    </form>
  );
}

function ImportFromSourceForm({ clients, onDone }: { clients: Clients; onDone: () => void }) {
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState("");
  const [pickedName, setPickedName] = useState("");
  const [countText, setCountText] = useState(String(DEFAULT_IMPORT_COUNT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ImportChannelResult[] | undefined>();
  const sourceId = useId();
  const countId = useId();

  const loadSources = useCallback(async () => {
    setSourcesError("");
    setSourcesLoading(true);
    try {
      const response = await clients.catalog.listImportSources({});
      setSources(response.sources);
    } catch (cause) {
      setSourcesError(errorText(cause, "Не вдалося завантажити перелік джерел."));
    } finally {
      setSourcesLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const picked =
    sources.find((item) => item.name === pickedName) ??
    sources.find((item) => item.available) ??
    sources[0];

  const count = Number(countText);
  const countValid =
    countText.trim() !== "" &&
    Number.isInteger(count) &&
    count >= IMPORT_COUNT_MIN &&
    count <= IMPORT_COUNT_MAX;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !picked?.available || !countValid) return;
    setBusy(true);
    setError("");
    setResults(undefined);
    try {
      const response = await clients.catalog.importChannelsFromSource({
        source: picked.name,
        limit: count,
      });
      setResults(response.results);
    } catch (cause) {
      setError(importFromSourceErrorText(cause, picked.name));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  if (sourcesLoading) return <Loading label="Завантаження джерел…" />;
  if (sourcesError) {
    return <ErrorState message={sourcesError} onRetry={() => void loadSources()} />;
  }
  if (sources.length === 0) {
    return (
      <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
        Джерел імпорту не налаштовано.
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col"
      style={{ gap: 12 }}
      aria-label="Імпорт каналів із джерела"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
        <div className="field" style={{ width: 260 }}>
          <label htmlFor={sourceId}>Джерело</label>
          <select
            id={sourceId}
            className="input"
            value={picked?.name ?? ""}
            onChange={(event) => setPickedName(event.target.value)}
          >
            {sources.map((item) => (
              <option key={item.name} value={item.name} disabled={!item.available}>
                {item.name} · {socialMediaLabels[item.socialMediaType]}
                {item.available ? "" : " — недоступне"}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ width: 180 }}>
          <label htmlFor={countId}>Скільки каналів узяти</label>
          <input
            id={countId}
            className="input"
            type="number"
            min={IMPORT_COUNT_MIN}
            max={IMPORT_COUNT_MAX}
            value={countText}
            onChange={(event) => setCountText(event.target.value)}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ height: 36 }}
          disabled={busy || !picked?.available || !countValid}
        >
          {busy ? "Імпортуємо…" : "Імпортувати"}
        </button>

        {!countValid && (
          <span className={textMuted} style={{ fontSize: 13 }}>
            Кількість — від {IMPORT_COUNT_MIN} до {IMPORT_COUNT_MAX}.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="m-0" style={{ fontSize: 13 }}>
          {error}
        </p>
      )}

      {results &&
        (results.length === 0 ? (
          <p className={`m-0 ${textMuted}`} style={{ fontSize: 13 }}>
            Джерело не назвало жодного каналу.
          </p>
        ) : (
          <ul className="m-0" style={{ paddingLeft: 18, fontSize: 13 }}>
            {results.map((item) => (
              <li key={item.username}>
                {item.channelId ? (
                  <Link to={`/channels/${item.channelId}`}>@{item.username}</Link>
                ) : (
                  <span>@{item.username}</span>
                )}{" "}
                <span className={textMuted}>— {importChannelOutcomeLabels[item.outcome]}</span>
              </li>
            ))}
          </ul>
        ))}
    </form>
  );
}

export function RemoveChannelDialog({
  clients,
  channel,
  onClose,
  onPaused,
  onRemoved,
}: {
  clients: Clients;
  channel: CatalogChannel;
  onClose: () => void;
  onPaused: (channel?: CatalogChannel) => void;
  onRemoved: (channelId: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [retain, setRetain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const confirmId = useId();
  const retainId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const channelId = channel.channel?.id ?? "";
  const handle = channelHandle(channel);
  const target = confirmationTarget(channel);
  const confirmation = typed.trim().replace(/^@/, "");
  const matches = target !== "" && normalizeHandle(typed) === normalizeHandle(target);
  const paused = channel.status === ChannelStatus.PAUSED;

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await clients.catalog.removeChannel({
        channelId,
        usernameConfirmation: confirmation,
        retainPosts: retain,
      });
      onRemoved(channelId);
    } catch (cause) {
      setError(removeErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    setBusy(true);
    setError("");
    try {
      const response = await clients.catalog.pauseChannel({ channelId });
      onPaused(response.channel);
    } catch (cause) {
      setError(errorText(cause, "Не вдалося поставити канал на паузу."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      style={{ zIndex: 20 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width: 560 }}
      >
        <div className="dialog-title" id={titleId}>
          Видалити {handle} із каталогу?
        </div>

        <div className="dialog-body flex flex-col" style={{ gap: 14 }}>
          <p className="m-0">
            Канал і зібрані по ньому дані буде вилучено з сервісу. Дія незворотна.
          </p>

          <div
            className="flex flex-col"
            style={{
              gap: 8,
              padding: "14px 16px",
              borderRadius: 8,
              background: "var(--color-bg)",
              fontSize: 13,
            }}
          >
            <DialogFact label="Публікацій зібрано">
              {channel.hasProfile && channel.profile
                ? fmtInt(channel.profile.postCount)
                : "ще немає даних"}
            </DialogFact>
            <DialogFact label="У каталозі з">{dateTime(channel.addedAt)}</DialogFact>
            <DialogFact label="Стан">{channelStatusLabels[channel.status]}</DialogFact>
          </div>

          <p className={`m-0 ${textSoft}`} style={{ fontSize: 13 }}>
            Якщо потрібно лише зупинити збір — поставте канал на паузу: дані й пари збережуться.
          </p>

          <label className="flex items-center" style={{ gap: 8, fontSize: 13 }} htmlFor={retainId}>
            <input
              id={retainId}
              type="checkbox"
              checked={retain}
              onChange={(event) => setRetain(event.target.checked)}
              style={{ accentColor: "var(--color-accent)" }}
            />
            Зберегти зібрані публікації 30 днів для можливого відновлення
          </label>

          <div className="field">
            <label htmlFor={confirmId}>Підтвердіть username каналу</label>
            <input
              id={confirmId}
              ref={inputRef}
              className="input"
              placeholder={handle}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="m-0" style={{ fontSize: 13 }}>
              {error}
            </p>
          )}
        </div>

        <div className="dialog-actions flex items-center" style={{ gap: 8 }}>
          {!paused && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 36, fontSize: 13, marginRight: "auto" }}
              disabled={busy}
              onClick={() => void pause()}
            >
              <i className="ph ph-pause" aria-hidden="true" />
              Поставити на паузу
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: 36, fontSize: 13, marginLeft: paused ? "auto" : undefined }}
            onClick={onClose}
          >
            Скасувати
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 36, fontSize: 13 }}
            disabled={!matches || busy}
            onClick={() => void remove()}
          >
            Видалити канал
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogFact({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex justify-between">
      <span className={textSoft}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}
