import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ChannelAddedEvent } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import { Page, Section } from "../components/Page";
import { AnalysisRunCard, IngestionRunCard } from "../components/RunCards";
import { SnapshotPicker } from "../components/SnapshotPicker";
import { Empty, ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { RunScreen } from "./RunScreen";

const PAGE_SIZE = 20;
const EVENTS_PAGE_SIZE = 20;

interface Props {
  clients: Clients;
  pollIntervalMs?: number;
}

export function RunsScreen({ clients, pollIntervalMs }: Props) {
  const [params, setParams] = useSearchParams();
  const snapshotId = params.get("snapshot") ?? "";
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRun[]>([]);
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRun[]>([]);
  const [adminEvents, setAdminEvents] = useState<ChannelAddedEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [ingestion, analysis, events] = await Promise.all([
          clients.ingestion.listIngestionRuns({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.duplication.listAnalysisRuns({ snapshotId, page: { pageSize: PAGE_SIZE } }),
          clients.catalog.listChannelAddedEvents({ page: { pageSize: EVENTS_PAGE_SIZE } }),
        ]);
        if (cancelled) return;
        setIngestionRuns(ingestion.runs);
        setAnalysisRuns(analysis.runs);
        setAdminEvents(events.events);
      } catch (cause) {
        if (!cancelled) setError(errorText(cause, "Не вдалося завантажити історію запусків."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clients, snapshotId, attempt]);

  const latestIngestion = ingestionRuns[0];
  const latestAnalysis = analysisRuns[0];

  return (
    <Page>
      <RunScreen
        clients={clients}
        snapshotId={snapshotId}
        snapshotPicker={
          <SnapshotPicker
            clients={clients}
            value={snapshotId}
            onChange={(next) => setParams(next ? { snapshot: next } : {})}
            emptyLabel="Усі снапшоти"
          />
        }
        latestIngestion={latestIngestion}
        latestAnalysis={latestAnalysis}
        adminEvents={adminEvents}
        pending={loading}
        pollIntervalMs={pollIntervalMs}
      />

      {error === "" ? null : (
        <ErrorState message={error} onRetry={() => setAttempt((current) => current + 1)} />
      )}

      <Section title="Історія запусків">
        {loading ? (
          <Loading label="Завантаження історії запусків…" />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
              gap: 14,
            }}
          >
            <section
              aria-labelledby="ingestion-runs-heading"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <h6 id="ingestion-runs-heading" style={{ margin: 0 }}>
                Збір
              </h6>
              {ingestionRuns.length === 0 ? (
                <Empty
                  title="Запусків збору поки немає."
                  hint="Історія наповнюється після першого запуску збору."
                />
              ) : (
                ingestionRuns.map((run) => <IngestionRunCard key={run.id} run={run} />)
              )}
            </section>

            <section
              aria-labelledby="analysis-runs-heading"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <h6 id="analysis-runs-heading" style={{ margin: 0 }}>
                Аналіз
              </h6>
              {analysisRuns.length === 0 ? (
                <Empty
                  title="Запусків аналізу поки немає."
                  hint="Аналіз доступний після успішного збору публікацій."
                />
              ) : (
                analysisRuns.map((run) => <AnalysisRunCard key={run.id} run={run} />)
              )}
            </section>
          </div>
        )}
      </Section>
    </Page>
  );
}
