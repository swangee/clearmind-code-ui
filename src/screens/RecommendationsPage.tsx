import { useSearchParams } from "react-router-dom";

import { Page } from "../components/Page";
import { SnapshotPicker } from "../components/SnapshotPicker";
import { Empty } from "../components/States";
import type { Clients } from "../lib/clients";
import { RecommendationsScreen } from "./RecommendationsScreen";

export function RecommendationsPage({ clients }: { clients: Clients }) {
  const [params, setParams] = useSearchParams();
  const snapshotId = params.get("snapshot") ?? "";

  return (
    <Page>
      <SnapshotPicker
        clients={clients}
        value={snapshotId}
        onChange={(next) => setParams(next ? { snapshot: next } : {})}
        emptyLabel="Оберіть снапшот"
      />

      {snapshotId ? (
        <RecommendationsScreen clients={clients} snapshotId={snapshotId} />
      ) : (
        <Empty
          title="Снапшот не обрано"
          hint="Оберіть снапшот, щоб побачити рекомендації за його аналізом."
        />
      )}
    </Page>
  );
}
