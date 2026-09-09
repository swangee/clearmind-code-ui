import { useCallback, useEffect, useState } from "react";

import { ConnectionState } from "@clearmind/contracts/clearmind/v1/account_pb";
import type { Subscription } from "@clearmind/contracts/clearmind/v1/subscription_pb";

import { Page, Section } from "../components/Page";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { fmtInt } from "../lib/format";
import {
  primaryButton,
  secondaryButton,
  table,
  tagOutline,
  textFaint,
  textMuted,
  textSoft,
} from "../lib/styles";

interface Props {
  clients: Clients;
  onSnapshotCreated: (snapshotId: string) => void;
}

export function AccountScreen({ clients, onSnapshotCreated }: Props) {
  const [state, setState] = useState(ConnectionState.UNSPECIFIED);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await clients.account.getStatus({});
      setState(response.state);
      setStatusError("");
    } catch (cause) {
      setStatusError(errorText(cause, "Не вдалося прочитати стан акаунта."));
    } finally {
      setLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause, "Операція не вдалася."));
    } finally {
      setBusy(false);
    }
  }

  const importSubscriptions = () =>
    guard(async () => {
      const response = await clients.subscription.importSubscriptions({});
      setSubscriptions(response.subscriptions);
      setSelected(
        new Set(
          response.subscriptions.filter((item) => item.isImportable).map((item) => item.channelId),
        ),
      );
      setImported(true);
    });

  const createSnapshot = () =>
    guard(async () => {
      const response = await clients.subscription.createSnapshot({
        memberChannelIds: [...selected],
      });
      if (response.snapshot) {
        onSnapshotCreated(response.snapshot.id);
      }
    });

  const isConnected = state === ConnectionState.CONNECTED;
  const importable = subscriptions.filter((item) => item.isImportable).length;

  return (
    <Page
      title="Акаунт і підписки"
      summary="Стан акаунта, з якого сервіс збирає публікації, і склад підписок для наступного снапшоту."
    >
      {error === "" ? null : (
        <p role="alert" className="card elev-sm" style={{ padding: "12px 16px", margin: 0 }}>
          <span className="flex items-center gap-2" style={{ fontSize: 14 }}>
            <i className="ph ph-warning" style={{ color: "var(--color-accent)" }} aria-hidden="true" />
            {error}
          </span>
        </p>
      )}

      {loading ? <Loading label="Читаємо стан акаунта…" /> : null}

      {!loading && statusError !== "" ? (
        <ErrorState message={statusError} onRetry={() => void refresh()} />
      ) : null}

      {!loading && statusError === "" && !isConnected ? (
        <div
          className="card elev-sm"
          style={{ padding: 24, gap: 14, alignItems: "flex-start", maxWidth: 620 }}
        >
          <div className="flex items-center gap-[10px]">
            <i
              className="ph ph-plugs"
              style={{ fontSize: 22, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 19 }}>
              Облікові дані Telegram не налаштовані
            </span>
          </div>

          <p className={textSoft} style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            Акаунт підключається не звідси. Заповніть <code>.env</code> у корені репозиторію й
            перерозгорніть стек — сервіс збору прочитає облікові дані звідти.
          </p>

          <ol
            className={`flex list-decimal flex-col gap-2 ${textSoft}`}
            style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}
          >
            <li>
              Скопіюйте <code>.env.example</code> у <code>.env</code> і впишіть{" "}
              <code>TELEGRAM_APP_ID</code> та <code>TELEGRAM_API_HASH</code>.
            </li>
            <li>
              Виконайте <code>make telegram-login</code> — команда проведе вхід у Telegram у
              терміналі.
            </li>
            <li>
              Покладіть отримане значення у <code>TELEGRAM_SESSION</code> і виконайте{" "}
              <code>make up</code>.
            </li>
          </ol>

          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className={secondaryButton}
            style={{ height: 38 }}
          >
            <i className="ph ph-arrows-clockwise" aria-hidden="true" />
            Оновити стан
          </button>
        </div>
      ) : null}

      {!loading && statusError === "" && isConnected ? (
        <div className="flex flex-col gap-5">
          <div
            className="flex flex-wrap items-center gap-4"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <i
              className="ph ph-plug"
              style={{ fontSize: 20, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <div className="flex flex-1 flex-col">
              <span style={{ fontSize: 14 }}>Акаунт підключено</span>
              <span className={textMuted} style={{ fontSize: 12 }}>
                Читаються назви й ідентифікатори каналів; вміст приватних чатів не завантажується.
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void importSubscriptions()}
              className={primaryButton}
              style={{ height: 38 }}
            >
              <i className="ph ph-download-simple" aria-hidden="true" />
              Імпортувати підписки
            </button>
          </div>

          {subscriptions.length > 0 ? (
            <Section
              title="Підписки акаунта"
              actions={
                <span className={textMuted} style={{ fontSize: 13 }}>
                  {fmtInt(subscriptions.length)} діалогів · {fmtInt(importable)} придатних для збору
                  · обрано {fmtInt(selected.size)}
                </span>
              }
            >
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <span className="sr-only">Обрано</span>
                      </th>
                      <th>Канал</th>
                      <th>Стан</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((item) => {
                      const id = item.channelId;
                      return (
                        <tr key={id}>
                          <td>
                            <input
                              type="checkbox"
                              id={`sub-${id}`}
                              disabled={!item.isImportable}
                              checked={selected.has(id)}
                              onChange={(event) => {
                                const { checked } = event.target;
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(id);
                                  else next.delete(id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td>
                            <label
                              htmlFor={`sub-${id}`}
                              className={item.isImportable ? undefined : textFaint}
                            >
                              {item.title}
                            </label>
                          </td>
                          <td>
                            {item.isImportable ? (
                              <span className={textMuted} style={{ fontSize: 12 }}>
                                Придатний
                              </span>
                            ) : (
                              <span className={tagOutline}>недоступний для збору</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-4" style={{ paddingTop: 8 }}>
                <button
                  type="button"
                  disabled={busy || selected.size === 0}
                  onClick={() => void createSnapshot()}
                  className={primaryButton}
                  style={{ height: 38 }}
                >
                  Створити снапшот
                  <i className="ph ph-arrow-right" aria-hidden="true" />
                </button>
                <p className={textFaint} style={{ margin: 0, fontSize: 12, maxWidth: 520 }}>
                  Снапшот фіксує склад підписок на цей момент — саме він стає основою наступного
                  збору й аналізу.
                </p>
              </div>
            </Section>
          ) : null}

          {imported && subscriptions.length === 0 ? (
            <Empty
              title="Підписок не знайдено"
              hint="Акаунт підключено, але каналів у ньому немає. Підпишіться в Telegram і повторіть імпорт."
            />
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}
