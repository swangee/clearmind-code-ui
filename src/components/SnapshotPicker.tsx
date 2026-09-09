import { useEffect, useState } from "react";

import type { SubscriptionSnapshot } from "@clearmind/contracts/clearmind/v1/subscription_pb";

import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { dateTime, shortId } from "../lib/format";
import { field, fieldGroup, textFaint } from "../lib/styles";

interface Props {
  clients: Clients;
  value: string;
  onChange: (snapshotId: string) => void;
  emptyLabel: string;
}

export function SnapshotPicker({ clients, value, onChange, emptyLabel }: Props) {
  const [snapshots, setSnapshots] = useState<SubscriptionSnapshot[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await clients.subscription.listSnapshots({ page: { pageSize: 50 } });
        if (!cancelled) setSnapshots(response.snapshots);
      } catch (cause) {
        if (!cancelled) setNote(errorText(cause, "Не вдалося завантажити снапшоти."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients]);

  return (
    <div className={fieldGroup} style={{ width: 340 }}>
      <label htmlFor="snapshot-picker">Снапшот</label>
      <select
        id="snapshot-picker"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={field}
      >
        <option value="">{emptyLabel}</option>
        {snapshots.map((snapshot) => (
          <option key={snapshot.id} value={snapshot.id}>
            {shortId(snapshot.id)} · {dateTime(snapshot.frozenAt)} · каналів: {snapshot.memberCount}
          </option>
        ))}
      </select>
      {note === "" ? null : (
        <p className={`m-0 ${textFaint}`} style={{ marginTop: 4, fontSize: 12 }}>
          {note}
        </p>
      )}
    </div>
  );
}
