import type { Timestamp } from "@bufbuild/protobuf";

import { AnalysisSchedule } from "@clearmind/contracts/clearmind/v1/analysis_settings_pb";
import { Role } from "@clearmind/contracts/clearmind/v1/auth_pb";
import type { Channel } from "@clearmind/contracts/clearmind/v1/channel_pb";
import {
  ChannelAddedSource,
  ChannelStatus,
  ImportChannelOutcome,
} from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";
import type { AnalysisRun } from "@clearmind/contracts/clearmind/v1/duplication_pb";
import {
  AnalysisStage,
  AnalysisTrigger,
  MatchEventKind,
  MatchVerdict,
  RelationKind,
  SignalKind,
} from "@clearmind/contracts/clearmind/v1/duplication_pb";
import type { IngestionRun } from "@clearmind/contracts/clearmind/v1/ingestion_pb";
import { ChannelIngestionState } from "@clearmind/contracts/clearmind/v1/ingestion_pb";
import { DecisionKind } from "@clearmind/contracts/clearmind/v1/recommendation_pb";
import type { RunFailure } from "@clearmind/contracts/clearmind/v1/common_pb";
import {
  RunFailureCode,
  RunStatus,
  SocialMediaType,
} from "@clearmind/contracts/clearmind/v1/common_pb";

export const relationLabels: Record<RelationKind, string> = {
  [RelationKind.UNSPECIFIED]: "Не визначено",
  [RelationKind.PERSISTENT_DUPLICATION]: "Стійке дублювання",
  [RelationKind.PARTIAL_OVERLAP]: "Часткове перекриття",
  [RelationKind.SOURCE_OVERLAP]: "Перекриття джерел",
  [RelationKind.INDEPENDENT]: "Незалежні",
  [RelationKind.INSUFFICIENT_DATA]: "Недостатньо даних",
};

export const signalLabels: Record<SignalKind, string> = {
  [SignalKind.UNSPECIFIED]: "Невідомий сигнал",
  [SignalKind.LEXICAL_OVERLAP]: "Лексичний збіг",
  [SignalKind.SEMANTIC_PROXIMITY]: "Семантична близькість",
  [SignalKind.SHARED_LINKS]: "Спільні посилання",
  [SignalKind.SHARED_DOMAINS]: "Спільні домени",
  [SignalKind.FORWARD]: "Пересилання",
  [SignalKind.TIMING]: "Часовий профіль",
};

export const decisionLabels: Record<DecisionKind, string> = {
  [DecisionKind.UNSPECIFIED]: "Без рішення",
  [DecisionKind.CONFIRMED]: "Підтверджено",
  [DecisionKind.REJECTED]: "Відхилено",
  [DecisionKind.DEFERRED]: "Відкладено",
};

export const runStatusLabels: Record<RunStatus, string> = {
  [RunStatus.UNSPECIFIED]: "Невідомо",
  [RunStatus.PENDING]: "У черзі",
  [RunStatus.RUNNING]: "Виконується",
  [RunStatus.SUCCEEDED]: "Завершено",
  [RunStatus.PARTIAL]: "Завершено частково",
  [RunStatus.FAILED]: "Помилка",
  [RunStatus.CANCELLED]: "Скасовано",
};

export const runFailureLabels: Record<RunFailureCode, string> = {
  [RunFailureCode.UNSPECIFIED]: "Причини запуск не назвав",
  [RunFailureCode.ACCOUNT_NOT_CONNECTED]: "Акаунт Telegram не підключено",
  [RunFailureCode.PLATFORM_UNAVAILABLE]: "Telegram недосяжний",
  [RunFailureCode.COLLECTION_UNUSABLE]: "Збір не дав придатних даних",
  [RunFailureCode.COLLECTION_WAIT_EXCEEDED]: "Збір не завершився за відведений час",
  [RunFailureCode.INTERNAL]: "Внутрішня помилка сервісу",
  [RunFailureCode.CHANNELS_FAILED]: "Канали зібрати не вдалося",
};

export const analysisTriggerLabels: Record<AnalysisTrigger, string> = {
  [AnalysisTrigger.UNSPECIFIED]: "Джерело запуску невідоме",
  [AnalysisTrigger.MANUAL]: "Запущено вручну",
  [AnalysisTrigger.AFTER_INGESTION]: "Після збору",
  [AnalysisTrigger.SCHEDULE]: "За розкладом",
};

export const channelIngestionStateLabels: Record<
  ChannelIngestionState,
  string
> = {
  [ChannelIngestionState.UNSPECIFIED]: "Стан не вказано",
  [ChannelIngestionState.QUEUED]: "У черзі",
  [ChannelIngestionState.COLLECTING]: "Збір",
  [ChannelIngestionState.RATE_LIMITED]: "Повтор запиту",
  [ChannelIngestionState.DONE]: "Готово",
  [ChannelIngestionState.REUSED]: "Зі снапшоту",
  [ChannelIngestionState.FAILED]: "Помилка",
  [ChannelIngestionState.SKIPPED]: "Пропущено",
};

export function channelIngestionStateTag(state: ChannelIngestionState): string {
  if (
    state === ChannelIngestionState.COLLECTING ||
    state === ChannelIngestionState.FAILED
  ) {
    return "tag tag-accent";
  }
  if (
    state === ChannelIngestionState.DONE ||
    state === ChannelIngestionState.REUSED
  ) {
    return "tag tag-neutral";
  }
  return "tag tag-outline";
}

export const analysisStageLabels: Record<AnalysisStage, string> = {
  [AnalysisStage.UNSPECIFIED]: "Етап не вказано",
  [AnalysisStage.LOADING_POSTS]: "Вивантаження публікацій",
  [AnalysisStage.SIGNATURES]: "Побудова підписів",
  [AnalysisStage.PAIR_COMPARISON]: "Порівняння пар каналів",
  [AnalysisStage.RECOMMENDATIONS]: "Формування рекомендацій",
};

export const socialMediaLabels: Record<SocialMediaType, string> = {
  [SocialMediaType.UNSPECIFIED]: "Платформа не вказана",
  [SocialMediaType.TELEGRAM]: "Telegram",
};

export const roleLabels: Record<Role, string> = {
  [Role.UNSPECIFIED]: "Без ролі",
  [Role.ADMIN]: "Адміністратор",
  [Role.USER]: "Користувач",
};

export const channelAddedSourceLabels: Record<ChannelAddedSource, string> = {
  [ChannelAddedSource.UNSPECIFIED]: "Невідоме джерело",
  [ChannelAddedSource.IMPORT]: "Імпорт підписок",
  [ChannelAddedSource.MANUAL]: "Додано вручну",
  [ChannelAddedSource.EXTERNAL]: "Імпорт із зовнішнього джерела",
};

export const importChannelOutcomeLabels: Record<ImportChannelOutcome, string> = {
  [ImportChannelOutcome.UNSPECIFIED]: "Результат невідомий",
  [ImportChannelOutcome.ADDED]: "Додано до каталогу",
  [ImportChannelOutcome.ALREADY_PRESENT]: "Уже в каталозі",
  [ImportChannelOutcome.REJECTED_GROUP]: "Відхилено: це група, а не канал",
  [ImportChannelOutcome.REJECTED_UNRESOLVED]: "Відхилено: username не розпізнано",
};

export const channelStatusLabels: Record<ChannelStatus, string> = {
  [ChannelStatus.UNSPECIFIED]: "Стан не вказано",
  [ChannelStatus.ACTIVE]: "Активний",
  [ChannelStatus.PAUSED]: "Пауза",
  [ChannelStatus.ERROR]: "Помилка збору",
};

export const matchVerdictLabels: Record<MatchVerdict, string> = {
  [MatchVerdict.UNSPECIFIED]: "Автоматично",
  [MatchVerdict.DUPLICATE]: "Дубль",
  [MatchVerdict.NOT_DUPLICATE]: "Не дубль",
};

export const matchEventLabels: Record<MatchEventKind, string> = {
  [MatchEventKind.UNSPECIFIED]: "Невідома подія",
  [MatchEventKind.MARKED_DUPLICATE]: "Позначено дублем",
  [MatchEventKind.MARKED_NOT_DUPLICATE]: "Позначено «не дубль»",
  [MatchEventKind.RESET]: "Повернуто автоматичний матчінг",
};

export const scheduleLabels: Record<AnalysisSchedule, string> = {
  [AnalysisSchedule.UNSPECIFIED]: "Не вказано",
  [AnalysisSchedule.DAILY]: "Щодня",
  [AnalysisSchedule.WEEKLY]: "Щотижня",
  [AnalysisSchedule.MANUAL]: "Вручну",
};

export function channelStatusTag(status: ChannelStatus): string {
  if (status === ChannelStatus.ACTIVE) return "tag tag-neutral";
  if (status === ChannelStatus.ERROR) return "tag tag-accent";
  return "tag tag-outline";
}

export function percent(value: number): string {
  const rounded = Math.round(value * 100);
  if (value > 0 && rounded === 0) return "<1%";
  return `${rounded}%`;
}

export function percentWidth(value: number): string {
  const rounded = Math.round(value * 100);
  if (value > 0 && rounded === 0) return "1%";
  return `${rounded}%`;
}

export function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("uk-UA").replace(/ /g, " ");
}

export function fmtSubs(value: number): string {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} тис.`;
  return String(value);
}

export type PluralForms = readonly [one: string, few: string, many: string];

export function pluralForm(count: number, forms: PluralForms): string {
  const value = Math.abs(Math.trunc(count));
  const tens = value % 100;
  const units = value % 10;
  if (units === 1 && tens !== 11) return forms[0];
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return forms[1];
  return forms[2];
}

export interface CollectionCoverage {
  delivered: number;
  total: number;
}

export function collectionCoverage(
  run?: IngestionRun,
): CollectionCoverage | undefined {
  if (!run || run.channels.length === 0) return undefined;
  let delivered = 0;
  for (const channel of run.channels) {
    if (
      channel.state === ChannelIngestionState.DONE ||
      channel.state === ChannelIngestionState.REUSED
    ) {
      delivered += 1;
    }
  }
  return { delivered, total: run.channelsTotal };
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} с`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} хв`;
  return `${(seconds / 3600).toFixed(1)} год`;
}

export function isRunFinished(status: RunStatus): boolean {
  return (
    status === RunStatus.SUCCEEDED ||
    status === RunStatus.PARTIAL ||
    status === RunStatus.FAILED ||
    status === RunStatus.CANCELLED
  );
}

export type ProcessingStage = "collection" | "analysis";

export const processingStageLabels: Record<ProcessingStage, string> = {
  collection: "Збір публікацій",
  analysis: "Аналіз дублів",
};

export interface StageOutcome {
  stage: ProcessingStage;
  title: string;
  status: RunStatus;
  failure?: RunFailure;
}

export function processingStages(
  ingestion?: IngestionRun,
  analysis?: AnalysisRun,
): StageOutcome[] {
  const stages: StageOutcome[] = [];
  if (ingestion) {
    stages.push({
      stage: "collection",
      title: processingStageLabels.collection,
      status: ingestion.status,
      failure: ingestion.failure,
    });
  }
  if (analysis) {
    stages.push({
      stage: "analysis",
      title: processingStageLabels.analysis,
      status: analysis.status,
      failure: analysis.failure,
    });
  }
  return stages;
}

export function failedStage(stages: StageOutcome[]): StageOutcome | undefined {
  return stages.find((stage) => stage.status === RunStatus.FAILED);
}

export function haltedStage(stages: StageOutcome[]): StageOutcome | undefined {
  return (
    failedStage(stages) ??
    stages.find((stage) => stage.status === RunStatus.CANCELLED) ??
    stages.find((stage) => stage.status === RunStatus.PARTIAL)
  );
}

export type AnalysisPhase =
  | "absent"
  | "awaiting-collection"
  | "queued"
  | "running"
  | "finished";

export function analysisPhase(run?: AnalysisRun): AnalysisPhase {
  if (!run) return "absent";
  if (isRunFinished(run.status)) return "finished";
  if (run.status !== RunStatus.PENDING) return "running";
  return run.awaitedIngestionRunId ? "awaiting-collection" : "queued";
}

export function isCancellable(run?: AnalysisRun): boolean {
  const phase = analysisPhase(run);
  return phase === "awaiting-collection" || phase === "queued";
}

export function dateTime(value?: Timestamp): string {
  if (!value) return "—";
  return value
    .toDate()
    .toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
}

export function channelName(channel?: Channel): string {
  if (!channel) return "Канал без назви";
  return (
    channel.title ||
    (channel.username && `@${channel.username}`) ||
    channel.foreignId
  );
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
