export const SNAPSHOT_ID = "3f1d0c8a-1c4b-4a1f-9c1e-000000000001";

export type RunStatus =
  | "RUN_STATUS_PENDING"
  | "RUN_STATUS_RUNNING"
  | "RUN_STATUS_SUCCEEDED"
  | "RUN_STATUS_PARTIAL"
  | "RUN_STATUS_FAILED"
  | "RUN_STATUS_CANCELLED";

export type FailureCode =
  | "RUN_FAILURE_CODE_ACCOUNT_NOT_CONNECTED"
  | "RUN_FAILURE_CODE_PLATFORM_UNAVAILABLE"
  | "RUN_FAILURE_CODE_COLLECTION_UNUSABLE"
  | "RUN_FAILURE_CODE_COLLECTION_WAIT_EXCEEDED"
  | "RUN_FAILURE_CODE_CHANNELS_FAILED"
  | "RUN_FAILURE_CODE_INTERNAL";

export interface RunFailure {
  code: FailureCode;
  message: string;
}

export type ChannelIngestionState =
  | "CHANNEL_INGESTION_STATE_QUEUED"
  | "CHANNEL_INGESTION_STATE_COLLECTING"
  | "CHANNEL_INGESTION_STATE_RATE_LIMITED"
  | "CHANNEL_INGESTION_STATE_DONE"
  | "CHANNEL_INGESTION_STATE_REUSED"
  | "CHANNEL_INGESTION_STATE_FAILED"
  | "CHANNEL_INGESTION_STATE_SKIPPED";

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

export function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    version: "2",
    frozenAt: secondsAgo(120),
    memberCount: 29,
    ...overrides,
  };
}

export function channelProgress(state: ChannelIngestionState, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    channelId: `4c000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    username: `e2e_channel_${index + 1}`,
    title: `Канал ${index + 1}`,
    state,
    postsIngested: 0,
    previouslyCollected: state === "CHANNEL_INGESTION_STATE_REUSED",
  }));
}

export function ingestionRun(
  status: RunStatus,
  overrides: {
    failure?: RunFailure;
    channelsProcessed?: number;
    postsIngested?: number;
    channelErrors?: unknown[];
    channels?: unknown[];
  } = {},
) {
  const {
    failure,
    channelsProcessed = 0,
    postsIngested = 0,
    channelErrors = [],
    channels = [],
  } = overrides;
  return {
    id: "irun-e2e-1",
    snapshotId: SNAPSHOT_ID,
    status,
    windowDays: 30,
    startedAt: secondsAgo(60),
    ...(isSettled(status) ? { finishedAt: secondsAgo(1) } : {}),
    channelsTotal: 29,
    channelsProcessed,
    postsIngested,
    channelErrors,
    channels,
    rateLimitWaits: 0,
    ...(failure ? { failure } : {}),
  };
}

export function analysisRun(
  status: RunStatus,
  overrides: { failure?: RunFailure; candidatesFound?: number } = {},
) {
  const { failure, candidatesFound = 0 } = overrides;
  return {
    id: "arun-e2e-1",
    snapshotId: SNAPSHOT_ID,
    status,
    algorithmVersion: "e2e",
    enqueuedAt: secondsAgo(60),
    startedAt: secondsAgo(50),
    ...(isSettled(status) ? { finishedAt: secondsAgo(1) } : {}),
    postsAnalyzed: 0,
    pairsCompared: 0,
    candidatesFound,
    channelErrors: [],
    stages: [],
    currentStage: "ANALYSIS_STAGE_UNSPECIFIED",
    trigger: "ANALYSIS_TRIGGER_IMPORT",
    awaitedIngestionRunId: "irun-e2e-1",
    ...(failure ? { failure } : {}),
  };
}

function isSettled(status: RunStatus): boolean {
  return (
    status === "RUN_STATUS_SUCCEEDED" ||
    status === "RUN_STATUS_PARTIAL" ||
    status === "RUN_STATUS_FAILED" ||
    status === "RUN_STATUS_CANCELLED"
  );
}

export function baseline(role: "ROLE_USER" | "ROLE_ADMIN" = "ROLE_USER") {
  return {
    GetCurrentUser: {
      user: { id: "u-e2e", username: "e2e", role, createdAt: secondsAgo(3600) },
    },
    GetStatus: {
      state: "CONNECTION_STATE_CONNECTED",
      account: { telegramId: "170456219", displayName: "E2E" },
    },
    ListSnapshots: { snapshots: [snapshot()], page: {} },
    GetAnalysisSettings: {
      settings: { collectionWindowDays: 30 },
    },
    ListChannels: { channels: [], page: {} },
    ListImportSources: {
      sources: [
        { name: "telegator", socialMediaType: "SOCIAL_MEDIA_TYPE_TELEGRAM", available: true },
      ],
    },
    ListChannelAddedEvents: { events: [], page: {} },
    ListCandidates: { candidates: [], page: {} },
    ListClusters: { clusters: [] },
    ListRecommendations: { recommendations: [], page: {} },
  };
}
