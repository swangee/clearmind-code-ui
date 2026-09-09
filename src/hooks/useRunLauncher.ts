import { useCallback, useEffect, useRef, useState } from "react";

import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";

import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { isRunFinished } from "../lib/format";

export interface RunAttachment {
  ingestionRunId?: string;
  analysisRunId?: string;
}

export interface RunLauncher {
  ingestion?: IngestionRun;
  analysis?: AnalysisRun;
  error: string;
  busy: boolean;
  startIngestion: (snapshotId: string, windowDays: number) => Promise<void>;
  startAnalysis: (
    snapshotId: string,
    afterIngestionRunId?: string,
  ) => Promise<void>;
  runPipeline: (snapshotId: string, windowDays: number) => Promise<void>;
  cancelAnalysis: (runId: string) => Promise<void>;
  attach: (attachment: RunAttachment) => void;
}

export function useRunLauncher(
  clients: Clients,
  pollIntervalMs = 2000,
): RunLauncher {
  const [ingestion, setIngestion] = useState<IngestionRun | undefined>();
  const [analysis, setAnalysis] = useState<AnalysisRun | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setInterval>>());

  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach(clearInterval);
      active.clear();
    };
  }, []);

  const stop = useCallback((timer: ReturnType<typeof setInterval>) => {
    clearInterval(timer);
    timers.current.delete(timer);
  }, []);

  const poll = useCallback(
    (step: (stop: () => void) => Promise<void>) => {
      const timer = setInterval(() => {
        void step(() => stop(timer));
      }, pollIntervalMs);
      timers.current.add(timer);
      void step(() => stop(timer));
    },
    [pollIntervalMs, stop],
  );

  const guard = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause, "Операція не вдалася."));
    } finally {
      setBusy(false);
    }
  }, []);

  const watchAnalysis = useCallback(
    (runId: string) => {
      poll(async (halt) => {
        try {
          const current = await clients.duplication.getAnalysisRun({ runId });
          setAnalysis(current.run);
          if (current.run && isRunFinished(current.run.status)) halt();
        } catch (cause) {
          halt();
          setError(errorText(cause, "Не вдалося прочитати стан аналізу."));
        }
      });
    },
    [clients, poll],
  );

  const launchAnalysis = useCallback(
    async (snapshotId: string, afterIngestionRunId?: string) => {
      const response = await clients.duplication.startAnalysis({
        snapshotId,
        afterIngestionRunId: afterIngestionRunId ?? "",
      });
      setAnalysis(response.run);
      if (response.run?.id) watchAnalysis(response.run.id);
    },
    [clients, watchAnalysis],
  );

  const watchIngestion = useCallback(
    (runId: string) => {
      poll(async (halt) => {
        try {
          const current = await clients.ingestion.getIngestionRun({ runId });
          setIngestion(current.run);
          if (current.run && isRunFinished(current.run.status)) halt();
        } catch (cause) {
          halt();
          setError(errorText(cause, "Не вдалося прочитати стан збору."));
        }
      });
    },
    [clients, poll],
  );

  const launchIngestion = useCallback(
    async (snapshotId: string, windowDays: number) => {
      const response = await clients.ingestion.startIngestion({
        snapshotId,
        windowDays,
      });
      setIngestion(response.run);
      if (response.run?.id) watchIngestion(response.run.id);
      return response.run?.id;
    },
    [clients, watchIngestion],
  );

  const startIngestion = useCallback(
    (snapshotId: string, windowDays: number) =>
      guard(async () => {
        await launchIngestion(snapshotId, windowDays);
      }),
    [guard, launchIngestion],
  );

  const startAnalysis = useCallback(
    (snapshotId: string, afterIngestionRunId?: string) =>
      guard(() => launchAnalysis(snapshotId, afterIngestionRunId)),
    [guard, launchAnalysis],
  );

  const runPipeline = useCallback(
    (snapshotId: string, windowDays: number) =>
      guard(async () => {
        const ingestionRunId = await launchIngestion(snapshotId, windowDays);
        await launchAnalysis(snapshotId, ingestionRunId);
      }),
    [guard, launchAnalysis, launchIngestion],
  );

  const cancelAnalysis = useCallback(
    (runId: string) =>
      guard(async () => {
        const response = await clients.duplication.cancelAnalysisRun({ runId });
        setAnalysis(response.run);
      }),
    [clients, guard],
  );

  const attach = useCallback(
    ({ ingestionRunId, analysisRunId }: RunAttachment) => {
      if (analysisRunId) watchAnalysis(analysisRunId);
      if (ingestionRunId) watchIngestion(ingestionRunId);
    },
    [watchAnalysis, watchIngestion],
  );

  return {
    ingestion,
    analysis,
    error,
    busy,
    startIngestion,
    startAnalysis,
    runPipeline,
    cancelAnalysis,
    attach,
  };
}
