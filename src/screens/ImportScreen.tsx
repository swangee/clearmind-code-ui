import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";

import {
  RunFailureCode,
  RunStatus,
} from "@clearmind/contracts/clearmind/v1/common_pb";
import {
  SubscriptionKind,
  SubscriptionVisibility,
  type Subscription,
  type SubscriptionSnapshot,
} from "@clearmind/contracts/clearmind/v1/subscription_pb";

import {
  ImportProcessing,
  freshlyCollected,
  recommendationsBuilt,
  reusedChannels,
} from "../components/ImportProcessing";
import { Page, Section } from "../components/Page";
import { Empty, ErrorState, Loading } from "../components/States";
import { useRunLauncher } from "../hooks/useRunLauncher";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import {
  failedStage,
  fmtInt,
  isRunFinished,
  processingStages,
  type ProcessingStage,
} from "../lib/format";
import {
  panel,
  primaryButton,
  secondaryButton,
  segmented,
  segmentedOption,
  table,
  tagAccent,
  tagNeutral,
  textFaint,
  textMuted,
  textSoft,
} from "../lib/styles";

type Filter = "all" | "channels" | "skipped";

type TypeKey = "channel" | "private-channel" | "group" | "other";

const typeLabels: Record<TypeKey, string> = {
  channel: "Канал",
  "private-channel": "Приватний канал",
  group: "Група",
  other: "Інший діалог",
};

const typeGroupLabels: Record<TypeKey, string> = {
  channel: "Канали",
  "private-channel": "Приватні канали",
  group: "Групи",
  other: "Інші діалоги",
};

const typeOrder: TypeKey[] = ["channel", "private-channel", "group", "other"];

function typeOf(item: Subscription): TypeKey {
  if (item.kind === SubscriptionKind.CHANNEL) {
    return item.visibility === SubscriptionVisibility.PRIVATE
      ? "private-channel"
      : "channel";
  }
  if (item.kind === SubscriptionKind.GROUP) return "group";
  return "other";
}

function isChannel(item: Subscription): boolean {
  return item.kind === SubscriptionKind.CHANNEL && item.isImportable;
}

function keyOf(item: Subscription, index: number): string {
  return (
    item.channelId ||
    item.foreignId ||
    item.username ||
    item.title ||
    `dialog-${index}`
  );
}

function bytesOf(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () =>
      reject(new Error("Не вдалося прочитати обраний файл."));
    reader.readAsArrayBuffer(file);
  });
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

interface Row {
  key: string;
  channelId: string;
  name: string;
  identifier: string;
  type: TypeKey;
  selectable: boolean;
}

function toRow(item: Subscription, index: number): Row {
  const type = typeOf(item);
  const selectable = isChannel(item);
  const hidden =
    !selectable && item.visibility === SubscriptionVisibility.PRIVATE;

  return {
    key: keyOf(item, index),
    channelId: item.channelId,
    name: hidden
      ? "Приватний діалог"
      : item.title || item.username || item.foreignId || "Без назви",
    identifier: hidden
      ? "—"
      : item.username
        ? `@${item.username}`
        : item.foreignId,
    type,
    selectable,
  };
}

interface Props {
  clients: Clients;
  pollIntervalMs?: number;
}

export function ImportScreen({ clients, pollIntervalMs }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<"read" | "confirm">("read");
  const [showSummary, setShowSummary] = useState(false);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const runs = useRunLauncher(clients, pollIntervalMs);

  const processing = snapshot !== undefined;
  const step = processing ? (showSummary ? 4 : 3) : rows ? 2 : 1;

  const analysisSettled =
    runs.analysis !== undefined && isRunFinished(runs.analysis.status);
  const analysisCancelled = runs.analysis?.status === RunStatus.CANCELLED;
  const broken = failedStage(processingStages(runs.ingestion, runs.analysis));
  const analysisDone =
    analysisSettled && !analysisCancelled && broken === undefined;

  useEffect(() => {
    if (startedAt === undefined) return undefined;
    const read = () =>
      setElapsedSeconds(Math.max(0, (Date.now() - startedAt) / 1000));
    read();
    if (analysisSettled) return undefined;
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [startedAt, analysisSettled]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshots = await clients.subscription.listSnapshots({
          page: { pageSize: 1 },
        });
        const newest = snapshots.snapshots[0];
        if (!newest) return;

        const [ingestion, analysis] = await Promise.all([
          clients.ingestion.listIngestionRuns({
            snapshotId: newest.id,
            page: { pageSize: 1 },
          }),
          clients.duplication.listAnalysisRuns({
            snapshotId: newest.id,
            page: { pageSize: 1 },
          }),
        ]);
        if (cancelled) return;

        const collect = ingestion.runs[0];
        const analyse = analysis.runs[0];
        const unfinished =
          (collect !== undefined && !isRunFinished(collect.status)) ||
          (analyse !== undefined && !isRunFinished(analyse.status));
        if (!unfinished) return;

        setSnapshot(newest);
        setStartedAt(
          collect?.startedAt
            ? Number(collect.startedAt.seconds) * 1000
            : Date.now(),
        );
        runs.attach({
          ingestionRunId: collect?.id,
          analysisRunId: analyse?.id,
        });
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const types = useMemo(() => {
    const present = rows ?? [];
    return typeOrder
      .map((key) => {
        const inType = present.filter((row) => row.type === key);
        return {
          key,
          total: inType.length,
          selectable: inType
            .filter((row) => row.selectable)
            .map((row) => row.key),
        };
      })
      .filter((type) => type.total > 0);
  }, [rows]);

  const all = rows ?? [];
  const selectableKeys = all
    .filter((row) => row.selectable)
    .map((row) => row.key);
  const channelCount = selectableKeys.length;
  const skippedCount = all.length - channelCount;
  const selectedCount = selectableKeys.filter((key) =>
    selected.has(key),
  ).length;
  const offCount = channelCount - selectedCount;
  const submittable = all
    .filter((row) => row.selectable && selected.has(row.key) && row.channelId)
    .map((row) => row.channelId);
  const visible = all.filter((row) => {
    if (filter === "channels") return row.selectable;
    if (filter === "skipped") return !row.selectable;
    return true;
  });

  async function read(source: File | null) {
    setLoading(true);
    setError("");
    try {
      const exportFile = source ? await bytesOf(source) : undefined;
      const response = await clients.subscription.importSubscriptions(
        exportFile ? { exportFile } : {},
      );
      const next = response.subscriptions.map(toRow);
      setRows(next);
      setSelected(
        new Set(next.filter((row) => row.selectable).map((row) => row.key)),
      );
      setFilter("all");
    } catch (cause) {
      setFailed("read");
      setError(
        errorText(
          cause,
          source
            ? "Не вдалося прочитати файл експорту."
            : "Не вдалося зчитати список діалогів.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (chosen === null) return;
    setFile(chosen);
    void read(chosen);
  }

  function replaceFile() {
    setFile(null);
    setRows(null);
    setSelected(new Set());
  }

  function toggleRow(key: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleType(keys: readonly string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function confirm() {
    setConfirming(true);
    setError("");
    try {
      const response = await clients.subscription.createSnapshot({
        memberChannelIds: submittable,
      });
      const frozen = response.snapshot;
      if (!frozen) throw new Error("Знімок підписок не створено.");

      await runs.runPipeline(frozen.id, 0);

      setSnapshot(frozen);
      setShowSummary(false);
      setStartedAt(Date.now());
    } catch (cause) {
      setFailed("confirm");
      setError(errorText(cause, "Не вдалося підтвердити вибір."));
    } finally {
      setConfirming(false);
    }
  }

  async function retry() {
    if (!snapshot || !broken) return;
    setStartedAt(Date.now());
    if (restartsCollection(broken.stage, broken.failure?.code)) {
      await runs.runPipeline(snapshot.id, 0);
      return;
    }
    await runs.startAnalysis(snapshot.id);
  }

  const imported = snapshot?.memberCount ?? 0;

  return (
    <Page
      title="Імпорт підписок"
      summary="Файл експорту Telegram Desktop Lite: Налаштування → Додаткові → Експорт даних → Список чатів. З файлу беруться лише назви, ідентифікатори й типи діалогів; вміст повідомлень не розбирається."
    >
      <ol
        aria-label="Кроки імпорту"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          margin: 0,
          padding: 0,
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <StepMark number={1} label="Файл" step={step} />
        <StepRule />
        <StepMark number={2} label="Перевірка" step={step} />
        <StepRule />
        <StepMark number={3} label="Обробка" step={step} />
        <StepRule />
        <StepMark number={4} label="Готово" step={step} />
      </ol>

      {error ? (
        <ErrorState
          message={error}
          onRetry={() => void (failed === "confirm" ? confirm() : read(file))}
        />
      ) : null}

      {!error && runs.error ? <ErrorState message={runs.error} /> : null}

      {loading ? <Loading label="Читаємо перелік діалогів…" /> : null}

      {step === 1 && !loading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 40,
            borderRadius: 8,
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-sm)",
            maxWidth: 620,
          }}
        >
          <i
            className="ph ph-file-arrow-up"
            aria-hidden="true"
            style={{ fontSize: 28, color: "var(--color-accent)" }}
          />
          <Section title="Завантажте result.json">
            <p
              className={`m-0 ${textSoft}`}
              style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 440 }}
            >
              Приймається файл експорту Telegram Desktop Lite: Налаштування →
              Додаткові → Експорт даних → Список чатів. Читаються лише назви й
              ідентифікатори діалогів. Групи, боти та приватні чати показуються
              як пропущені, їхній вміст не завантажується. Канали, які ви
              покинули, до імпорту не потрапляють.
            </p>
            <input
              ref={picker}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Файл експорту Telegram Desktop Lite (result.json)"
              onChange={choose}
            />
            <button
              type="button"
              className={primaryButton}
              style={{ height: 38, alignSelf: "flex-start" }}
              onClick={() => picker.current?.click()}
            >
              Обрати файл
            </button>
            <div style={{ height: 1, background: "var(--color-divider)" }} />
            <p
              className={`m-0 ${textSoft}`}
              style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 440 }}
            >
              Якщо акаунт Telegram уже підключено, перелік діалогів можна
              зчитати просто з нього — без файлу.
            </p>
            <button
              type="button"
              className={secondaryButton}
              style={{ height: 38, alignSelf: "flex-start" }}
              onClick={() => void read(null)}
            >
              Зчитати діалоги
            </button>
          </Section>
        </div>
      ) : null}

      {step === 2 && !loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--color-surface)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <i
              className="ph ph-file-arrow-up"
              aria-hidden="true"
              style={{ fontSize: 20, color: "var(--color-accent)" }}
            />
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <span style={{ fontSize: 14 }}>
                {file ? file.name : "Підписки Telegram"}
              </span>
              <span className={textMuted} style={{ fontSize: 12 }}>
                {file ? `${fileSize(file.size)} · ` : ""}
                {fmtInt(all.length)} діалогів у переліку
              </span>
            </div>
            <button
              type="button"
              className={secondaryButton}
              style={{ fontSize: 13 }}
              onClick={() => (file ? replaceFile() : void read(null))}
            >
              {file ? "Замінити файл" : "Зчитати заново"}
            </button>
          </div>

          {all.length === 0 ? (
            <Empty
              title="Жодного діалогу не розпізнано"
              hint={
                file
                  ? "У файлі експорту немає жодного діалогу. Перевірте, що експорт містить список чатів."
                  : "Акаунт Telegram не має підписок або їх ще не синхронізовано. Спробуйте зчитати перелік ще раз."
              }
              action={
                <button
                  type="button"
                  className={secondaryButton}
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => (file ? replaceFile() : void read(null))}
                >
                  {file ? "Замінити файл" : "Зчитати заново"}
                </button>
              }
            />
          ) : (
            <Section
              title="Розпізнані канали"
              actions={
                <>
                  <span className={textMuted} style={{ fontSize: 13 }}>
                    {fmtInt(channelCount)} із {fmtInt(all.length)} діалогів ·{" "}
                    {fmtInt(skippedCount)} пропущено (групи, боти, приватні
                    чати)
                  </span>
                  <div
                    className={segmented}
                    role="group"
                    aria-label="Подання переліку"
                  >
                    <label className={segmentedOption}>
                      <input
                        type="radio"
                        name="import-filter"
                        checked={filter === "all"}
                        onChange={() => setFilter("all")}
                      />
                      Усі {fmtInt(all.length)}
                    </label>
                    <label className={segmentedOption}>
                      <input
                        type="radio"
                        name="import-filter"
                        checked={filter === "channels"}
                        onChange={() => setFilter("channels")}
                      />
                      Канали {fmtInt(channelCount)}
                    </label>
                    <label className={segmentedOption}>
                      <input
                        type="radio"
                        name="import-filter"
                        checked={filter === "skipped"}
                        onChange={() => setFilter("skipped")}
                      />
                      Пропущені {fmtInt(skippedCount)}
                    </label>
                  </div>
                </>
              }
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "var(--color-surface)",
                  boxShadow: "var(--shadow-sm)",
                  flexWrap: "wrap",
                }}
              >
                <span className={textMuted} style={{ fontSize: 13 }}>
                  Імпортувати типи
                </span>
                {types.map((type) => {
                  const on =
                    type.selectable.length > 0 &&
                    type.selectable.every((key) => selected.has(key));
                  return (
                    <label
                      key={type.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 14,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={type.selectable.length === 0}
                        onChange={(event) =>
                          toggleType(type.selectable, event.target.checked)
                        }
                        style={{ accentColor: "var(--color-accent)" }}
                      />
                      {typeGroupLabels[type.key]}
                      <span className={textFaint}>{fmtInt(type.total)}</span>
                    </label>
                  );
                })}
                <span
                  className={textFaint}
                  style={{ marginLeft: "auto", fontSize: 12 }}
                >
                  {fmtInt(offCount)} каналів знято з імпорту · вимкнення типу
                  знімає позначки з усіх рядків цього типу
                </span>
              </div>

              {visible.length === 0 ? (
                <Empty
                  title="У цьому поданні немає діалогів"
                  hint="Змініть подання, щоб побачити решту переліку."
                />
              ) : (
                <table className={table}>
                  <caption className="sr-only">
                    Розпізнані діалоги акаунта
                  </caption>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              channelCount > 0 && selectedCount === channelCount
                            }
                            disabled={channelCount === 0}
                            onChange={(event) =>
                              toggleType(selectableKeys, event.target.checked)
                            }
                            style={{ accentColor: "var(--color-accent)" }}
                          />
                          <span className="sr-only">
                            Позначити всі розпізнані канали
                          </span>
                        </label>
                      </th>
                      <th>Діалог</th>
                      <th>Ідентифікатор</th>
                      <th>Тип</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.key}>
                        <td>
                          {row.selectable ? (
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(row.key)}
                                onChange={(event) =>
                                  toggleRow(row.key, event.target.checked)
                                }
                                style={{ accentColor: "var(--color-accent)" }}
                              />
                              <span className="sr-only">{`Імпортувати «${row.name}»`}</span>
                            </label>
                          ) : null}
                        </td>
                        <td className={row.selectable ? undefined : textMuted}>
                          {row.name}
                        </td>
                        <td className={textMuted}>{row.identifier}</td>
                        <td className={row.selectable ? undefined : textMuted}>
                          {typeLabels[row.type]}
                        </td>
                        <td>
                          <span
                            className={row.selectable ? tagAccent : tagNeutral}
                          >
                            {row.selectable ? "Розпізнано" : "Пропущено"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  paddingTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className={primaryButton}
                  style={{ height: 38 }}
                  disabled={confirming || submittable.length === 0}
                  onClick={() => void confirm()}
                >
                  Підтвердити {fmtInt(selectedCount)} каналів
                  <i className="ph ph-arrow-right" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  style={{ height: 38 }}
                  onClick={replaceFile}
                >
                  Назад
                </button>
                <p
                  className={`m-0 ${textFaint}`}
                  style={{ fontSize: 12, maxWidth: 520 }}
                >
                  Зберігаються назви, ідентифікатори та тексти публікацій
                  позначених каналів. Приватні чати й вміст груп не
                  завантажуються.
                </p>
              </div>
            </Section>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <ImportProcessing
          ingestion={runs.ingestion}
          analysis={runs.analysis}
          elapsedSeconds={elapsedSeconds}
          busy={runs.busy}
          onCancelAnalysis={
            runs.analysis ? () => void runs.cancelAnalysis(runs.analysis!.id) : undefined
          }
          actions={
            <>
              {broken ? (
                broken.failure?.code ===
                RunFailureCode.ACCOUNT_NOT_CONNECTED ? (
                  <Link
                    to="/account"
                    className={primaryButton}
                    style={{ height: 36 }}
                  >
                    Підключити акаунт Telegram
                    <i className="ph ph-arrow-right" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={primaryButton}
                    style={{ height: 36 }}
                    disabled={runs.busy || snapshot === undefined}
                    onClick={() => void retry()}
                  >
                    {retryLabel(broken.stage, broken.failure?.code)}
                  </button>
                )
              ) : null}
              <Link
                to="/review"
                className={broken ? secondaryButton : primaryButton}
                style={{ height: 36 }}
              >
                {analysisDone
                  ? "Перейти до ревізії"
                  : broken
                    ? "Відкрити ревізію"
                    : "Продовжити у фоні"}
                <i className="ph ph-arrow-right" aria-hidden="true" />
              </Link>
              {analysisDone ? (
                <button
                  type="button"
                  className={secondaryButton}
                  style={{ height: 36 }}
                  onClick={() => setShowSummary(true)}
                >
                  Підсумок імпорту
                </button>
              ) : null}
              {analysisCancelled && snapshot ? (
                <button
                  type="button"
                  className={secondaryButton}
                  style={{ height: 36 }}
                  disabled={runs.busy}
                  onClick={() => void runs.startAnalysis(snapshot.id)}
                >
                  Запустити аналіз
                </button>
              ) : null}
            </>
          }
        />
      ) : null}

      {step === 4 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 620,
          }}
        >
          <div className={panel} style={{ padding: 24, gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <i
                className="ph ph-check-circle"
                aria-hidden="true"
                style={{ fontSize: 22, color: "var(--color-accent)" }}
              />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 19 }}>
                Імпортовано {fmtInt(imported)} каналів
              </span>
            </div>
            <dl
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 13,
                margin: 0,
              }}
            >
              <SummaryRow
                label="Уже в каталозі"
                value={fmtInt(reusedChannels(runs.ingestion))}
              />
              <SummaryRow
                label="Нових каналів зібрано"
                value={fmtInt(freshlyCollected(runs.ingestion))}
              />
              <SummaryRow
                label="Публікацій оброблено"
                value={fmtInt(runs.analysis?.postsAnalyzed ?? 0)}
              />
              <SummaryRow
                label="Пар оцінено"
                value={fmtInt(runs.analysis?.pairsCompared ?? 0)}
              />
              <SummaryRow
                label="Рекомендацій сформовано"
                value={fmtInt(recommendationsBuilt(runs.analysis))}
              />
              <SummaryRow
                label="Вікно збору"
                value={
                  runs.ingestion?.windowDays
                    ? `${fmtInt(runs.ingestion.windowDays)} днів`
                    : "—"
                }
              />
            </dl>
            <p
              className={`m-0 ${textSoft}`}
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              Знімок готовий: ревізія відкриється на щойно зібраних даних.
              Канали, зібрані достатньо недавно, взято з попереднього збору —
              повторне читання історії для них не запускалося.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to="/review" className={primaryButton} style={{ height: 38 }}>
              Перейти до ревізії
              <i className="ph ph-arrow-right" aria-hidden="true" />
            </Link>
            <button
              type="button"
              className={secondaryButton}
              style={{ height: 38 }}
              onClick={() => setShowSummary(false)}
            >
              Стан обробки
            </button>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

function restartsCollection(
  stage: ProcessingStage,
  code?: RunFailureCode,
): boolean {
  return (
    stage === "collection" ||
    code === RunFailureCode.COLLECTION_UNUSABLE ||
    code === RunFailureCode.COLLECTION_WAIT_EXCEEDED
  );
}

function retryLabel(
  stage: ProcessingStage,
  code?: RunFailureCode,
): string {
  return restartsCollection(stage, code)
    ? "Повторити збір"
    : "Повторити аналіз";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <dt className={textSoft}>{label}</dt>
      <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{value}</dd>
    </div>
  );
}

function StepMark({
  number,
  label,
  step,
}: {
  number: number;
  label: string;
  step: number;
}) {
  const reached = number <= step;
  return (
    <li
      aria-current={number === step ? "step" : undefined}
      className={reached ? undefined : textFaint}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: reached ? "var(--color-accent)" : undefined,
        listStyle: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: "1px solid currentColor",
          fontSize: 11,
        }}
      >
        {number}
      </span>
      {label}
    </li>
  );
}

function StepRule() {
  return (
    <li
      aria-hidden="true"
      style={{
        width: 48,
        height: 1,
        background: "var(--color-divider)",
        listStyle: "none",
      }}
    />
  );
}
