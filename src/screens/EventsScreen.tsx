import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { ChannelAddedEvent } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";

import { Page } from "../components/Page";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { channelAddedSourceLabels, dateTime, shortId } from "../lib/format";
import { secondaryButton, table, textMuted, textSoft } from "../lib/styles";

const PAGE_SIZE = 50;

export function EventsScreen({ clients }: { clients: Clients }) {
  const [events, setEvents] = useState<ChannelAddedEvent[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (pageToken: string) => {
      setError("");
      setLoading(true);
      try {
        const response = await clients.catalog.listChannelAddedEvents({
          page: { pageSize: PAGE_SIZE, pageToken },
        });
        setEvents((current) => (pageToken ? [...current, ...response.events] : response.events));
        setNextPageToken(response.page?.nextPageToken ?? "");
      } catch (cause) {
        setError(errorText(cause, "Не вдалося завантажити журнал."));
      } finally {
        setLoading(false);
      }
    },
    [clients],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <Page
      title="Додані канали"
      summary="Кожне додавання каналу до каталогу — ручне чи під час імпорту підписок."
    >

      {error === "" ? null : <ErrorState message={error} onRetry={() => void load("")} />}

      {loading && events.length === 0 ? (
        <Loading label="Завантаження журналу…" />
      ) : events.length === 0 ? (
        error === "" ? (
          <Empty
            title="Журнал порожній."
            hint="Запис зʼявляється щоразу, коли канал потрапляє до каталогу."
          />
        ) : null
      ) : (
        <table className={table}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>Час</th>
              <th style={{ width: 190 }}>Джерело</th>
              <th>Канал</th>
              <th style={{ width: 220 }}>Ініціатор</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className={`tabular-nums ${textMuted}`}>{dateTime(event.occurredAt)}</td>
                <td className={textSoft}>{channelAddedSourceLabels[event.source]}</td>
                <td>
                  <Link to={`/channels/${event.channelId}`}>Канал {shortId(event.channelId)}</Link>
                </td>
                <td className={textSoft}>
                  {event.appUsername || event.appUserId || "без ініціатора"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextPageToken === "" ? null : (
        <button
          type="button"
          onClick={() => void load(nextPageToken)}
          className={secondaryButton}
          style={{ alignSelf: "flex-start", height: 36 }}
          disabled={loading}
        >
          Показати ще
        </button>
      )}
    </Page>
  );
}
