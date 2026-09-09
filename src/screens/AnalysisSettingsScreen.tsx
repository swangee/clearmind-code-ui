import { useCallback, useEffect, useState } from "react";

import type { PartialMessage } from "@bufbuild/protobuf";
import {
  AnalysisSchedule,
  type AnalysisSettings,
} from "@clearmind/contracts/clearmind/v1/analysis_settings_pb";

import { Page, Section } from "../components/Page";
import { ErrorState, Loading } from "../components/States";
import type { Clients } from "../lib/clients";
import { errorText } from "../lib/errors";
import { dateTime, scheduleLabels, shortId } from "../lib/format";
import {
  field,
  fieldGroup,
  panel,
  primaryButton,
  quietButton,
  textFaint,
  textMuted,
  textSoft,
} from "../lib/styles";

const WEIGHT_TOLERANCE = 0.001;

const TOPIC_CATALOG = ["Сповіщення", "Погода", "Курси валют", "Транспорт"];

const SCHEDULE_OPTIONS = [
  AnalysisSchedule.DAILY,
  AnalysisSchedule.WEEKLY,
  AnalysisSchedule.MANUAL,
] as const;

interface Draft {
  collectionWindowDays: string;
  minPostsPerChannel: string;
  minPostLength: string;
  duplicateThreshold: string;
  postSimilarityThreshold: string;
  timeMatchWindowHours: string;
  lexical: string;
  links: string;
  forwards: string;
  timing: string;
  minClusterSize: string;
  sourceOverlapThreshold: string;
  recommendationsPerAccount: string;
  lossWarningThreshold: string;
  excludedTopics: string[];
  schedule: AnalysisSchedule;
}

type NumericKey = Exclude<keyof Draft, "excludedTopics" | "schedule">;

const LABELS: Record<NumericKey, string> = {
  collectionWindowDays: "Вікно збору, днів",
  minPostsPerChannel: "Мінімум публікацій у каналі",
  minPostLength: "Мінімальна довжина допису",
  duplicateThreshold: "Поріг дубля, частка збігів",
  postSimilarityThreshold: "Схожість допису від",
  timeMatchWindowHours: "Вікно збігу за часом, год",
  lexical: "Лексика",
  links: "Посилання",
  forwards: "Пересилання",
  timing: "Час публікації",
  minClusterSize: "Мінімальний розмір кластера",
  sourceOverlapThreshold: "Поріг перекриття джерел",
  recommendationsPerAccount: "Рекомендацій на акаунт",
  lossWarningThreshold: "Поріг ризику втрати, частка унікального",
};

const POSITIVE_KEYS: NumericKey[] = [
  "collectionWindowDays",
  "minPostsPerChannel",
  "minPostLength",
  "timeMatchWindowHours",
  "minClusterSize",
  "recommendationsPerAccount",
];

const FRACTION_KEYS: NumericKey[] = [
  "duplicateThreshold",
  "postSimilarityThreshold",
  "sourceOverlapThreshold",
  "lossWarningThreshold",
  "lexical",
  "links",
  "forwards",
  "timing",
];

const WEIGHT_KEYS = ["lexical", "links", "forwards", "timing"] as const;

const DEFAULT_DRAFT: Draft = {
  collectionWindowDays: "30",
  minPostsPerChannel: "20",
  minPostLength: "120",
  duplicateThreshold: "0.6",
  postSimilarityThreshold: "0.8",
  timeMatchWindowHours: "24",
  lexical: "0.5",
  links: "0.2",
  forwards: "0.2",
  timing: "0.1",
  minClusterSize: "3",
  sourceOverlapThreshold: "0.5",
  recommendationsPerAccount: "10",
  lossWarningThreshold: "0.3",
  excludedTopics: [],
  schedule: AnalysisSchedule.DAILY,
};

function parseNumber(raw: string): number {
  const text = raw.trim().replace(",", ".");
  if (!text) return Number.NaN;
  return Number(text);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number(value.toFixed(3)).toLocaleString("uk-UA");
}

function toDraft(settings: AnalysisSettings): Draft {
  const weights = settings.weights;
  return {
    collectionWindowDays: String(settings.collectionWindowDays),
    minPostsPerChannel: String(settings.minPostsPerChannel),
    minPostLength: String(settings.minPostLength),
    duplicateThreshold: String(settings.duplicateThreshold),
    postSimilarityThreshold: String(settings.postSimilarityThreshold),
    timeMatchWindowHours: String(settings.timeMatchWindowHours),
    lexical: String(weights?.lexical ?? 0),
    links: String(weights?.links ?? 0),
    forwards: String(weights?.forwards ?? 0),
    timing: String(weights?.timing ?? 0),
    minClusterSize: String(settings.minClusterSize),
    sourceOverlapThreshold: String(settings.sourceOverlapThreshold),
    recommendationsPerAccount: String(settings.recommendationsPerAccount),
    lossWarningThreshold: String(settings.lossWarningThreshold),
    excludedTopics: [...settings.excludedTopics],
    schedule: settings.schedule,
  };
}

function toSettings(draft: Draft): PartialMessage<AnalysisSettings> {
  return {
    collectionWindowDays: parseNumber(draft.collectionWindowDays),
    minPostsPerChannel: parseNumber(draft.minPostsPerChannel),
    minPostLength: parseNumber(draft.minPostLength),
    duplicateThreshold: parseNumber(draft.duplicateThreshold),
    postSimilarityThreshold: parseNumber(draft.postSimilarityThreshold),
    timeMatchWindowHours: parseNumber(draft.timeMatchWindowHours),
    weights: {
      lexical: parseNumber(draft.lexical),
      links: parseNumber(draft.links),
      forwards: parseNumber(draft.forwards),
      timing: parseNumber(draft.timing),
    },
    minClusterSize: parseNumber(draft.minClusterSize),
    sourceOverlapThreshold: parseNumber(draft.sourceOverlapThreshold),
    recommendationsPerAccount: parseNumber(draft.recommendationsPerAccount),
    lossWarningThreshold: parseNumber(draft.lossWarningThreshold),
    excludedTopics: draft.excludedTopics,
    schedule: draft.schedule,
  };
}

interface Problem {
  key: NumericKey | "weights";
  text: string;
}

function validate(draft: Draft, weightSum: number): Problem[] {
  const problems: Problem[] = [];

  for (const key of POSITIVE_KEYS) {
    const value = parseNumber(draft[key]);
    if (!Number.isInteger(value) || value <= 0) {
      problems.push({ key, text: `«${LABELS[key]}» — додатне ціле число.` });
    }
  }

  for (const key of FRACTION_KEYS) {
    const value = parseNumber(draft[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      problems.push({ key, text: `«${LABELS[key]}» — число від 0 до 1.` });
    }
  }

  if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
    problems.push({
      key: "weights",
      text: `Сума ваг сигналів має дорівнювати 1, зараз ${formatNumber(weightSum)}.`,
    });
  }

  return problems;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  integer: boolean;
  width?: string;
  onChange: (value: string) => void;
}

function NumberField({ id, label, value, invalid, integer, width, onChange }: NumberFieldProps) {
  return (
    <div className={fieldGroup} style={width === undefined ? undefined : { width }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={field}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function AnalysisSettingsScreen({ clients }: { clients: Clients }) {
  const [saved, setSaved] = useState<AnalysisSettings | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    setDraft(undefined);
    try {
      const response = await clients.analysisSettings.getAnalysisSettings({});
      setSaved(response.settings);
      setDraft(response.settings ? toDraft(response.settings) : { ...DEFAULT_DRAFT });
    } catch (cause) {
      setLoadError(errorText(cause, "Не вдалося завантажити параметри аналізу."));
    }
  }, [clients]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <Page title="Параметри аналізу">
        <ErrorState message={loadError} onRetry={() => void load()} />
      </Page>
    );
  }

  if (!draft) {
    return (
      <Page title="Параметри аналізу">
        <Loading label="Завантаження параметрів аналізу…" />
      </Page>
    );
  }

  const weightSum = WEIGHT_KEYS.reduce((total, key) => total + parseNumber(draft[key]), 0);
  const sumOk = Number.isFinite(weightSum) && Math.abs(weightSum - 1) <= WEIGHT_TOLERANCE;
  const problems = validate(draft, weightSum);
  const invalid = new Set(problems.map((problem) => problem.key));
  const topics = [
    ...TOPIC_CATALOG,
    ...draft.excludedTopics.filter((topic) => !TOPIC_CATALOG.includes(topic)),
  ];

  const patch = (part: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...part } : current));
    setJustSaved(false);
    setSaveError("");
  };

  const toggleTopic = (topic: string, on: boolean) =>
    setDraft((current) => {
      if (!current) return current;
      const excludedTopics = on
        ? [...current.excludedTopics, topic]
        : current.excludedTopics.filter((item) => item !== topic);
      return { ...current, excludedTopics };
    });

  function reset() {
    setDraft({ ...DEFAULT_DRAFT });
    setJustSaved(false);
    setSaveError("");
  }

  async function save() {
    if (!draft || problems.length > 0) {
      setSaveError(`Параметри не збережено. ${problems.map((item) => item.text).join(" ")}`);
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const response = await clients.analysisSettings.updateAnalysisSettings({
        settings: toSettings(draft),
      });
      if (response.settings) {
        setSaved(response.settings);
        setDraft(toDraft(response.settings));
      }
      setJustSaved(true);
    } catch (cause) {
      setSaveError(errorText(cause, "Не вдалося зберегти параметри."));
    } finally {
      setSaving(false);
    }
  }

  const numberField = (key: NumericKey, integer: boolean, width?: string) => (
    <NumberField
      id={`setting-${key}`}
      label={LABELS[key]}
      value={draft[key]}
      integer={integer}
      invalid={invalid.has(key)}
      width={width}
      onChange={(value) => patch({ [key]: value } as Partial<Draft>)}
    />
  );

  return (
    <Page
      title="Параметри аналізу"
      summary="Застосуються з наступного запуску. Ручні рішення по парах зберігаються."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Section title="Збір">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {numberField("collectionWindowDays", true)}
              {numberField("minPostsPerChannel", true)}
              {numberField("minPostLength", true)}
            </div>
            <span className={textFaint} style={{ fontSize: 12 }}>
              Канали, що не набрали мінімуму, лишаються в каталозі, але в порівняння не потрапляють.
            </span>
          </Section>

          <Section title="Схожість">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {numberField("duplicateThreshold", false)}
              {numberField("postSimilarityThreshold", false)}
              {numberField("timeMatchWindowHours", true)}
            </div>
            <div className={panel} style={{ gap: 10, padding: "16px 18px", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14 }}>Ваги сигналів</span>
                <span
                  role="status"
                  aria-live="polite"
                  className={sumOk ? textFaint : undefined}
                  style={{ fontSize: 12, color: sumOk ? undefined : "var(--color-accent)" }}
                >
                  {sumOk
                    ? `Сума ${formatNumber(weightSum)}`
                    : `Сума ${formatNumber(weightSum)} — має дорівнювати 1`}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {numberField("lexical", false)}
                {numberField("links", false)}
                {numberField("forwards", false)}
                {numberField("timing", false)}
              </div>
              <span className={textFaint} style={{ fontSize: 12 }}>
                Метрики зберігаються окремо, тому зміна ваг перераховує підсумок без повторного
                збору.
              </span>
            </div>
          </Section>

          <Section title="Кластеризація, джерела та рекомендації">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {numberField("minClusterSize", true)}
              {numberField("sourceOverlapThreshold", false)}
              {numberField("recommendationsPerAccount", true)}
            </div>

            <div className={panel} style={{ gap: 10, padding: "16px 18px", borderRadius: 8 }}>
              <span style={{ fontSize: 14 }} id="excluded-topics-title">
                Тематики поза рекомендаціями
              </span>
              <div
                role="group"
                aria-labelledby="excluded-topics-title"
                style={{ display: "flex", gap: 18, flexWrap: "wrap" }}
              >
                {topics.map((topic) => (
                  <label
                    key={topic}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}
                  >
                    <input
                      type="checkbox"
                      checked={draft.excludedTopics.includes(topic)}
                      onChange={(event) => toggleTopic(topic, event.target.checked)}
                    />
                    {topic}
                  </label>
                ))}
              </div>
              <span className={textFaint} style={{ fontSize: 12 }}>
                Дублювання в цих тематиках рахується й показується, але зняти канал сервіс не
                пропонує.
              </span>
            </div>

            <div className={panel} style={{ gap: 10, padding: "16px 18px", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14 }}>Попереджати про ризик втрати</span>
                  <span className={textMuted} style={{ fontSize: 12 }}>
                    Якщо унікального матеріалу більше за поріг, рекомендація виходить із
                    застереженням
                  </span>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  {numberField("lossWarningThreshold", false, "170px")}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14 }} id="schedule-title">
                    Розклад запусків
                  </span>
                  <span className={textMuted} style={{ fontSize: 12 }}>
                    Автоматичний збір і аналіз для всіх акаунтів
                  </span>
                </div>
                <div
                  className="seg"
                  role="radiogroup"
                  aria-labelledby="schedule-title"
                  style={{ marginLeft: "auto" }}
                >
                  {SCHEDULE_OPTIONS.map((option) => (
                    <label key={option} className="seg-opt">
                      <input
                        type="radio"
                        name="analysis-schedule"
                        checked={draft.schedule === option}
                        onChange={() => patch({ schedule: option })}
                      />
                      {scheduleLabels[option]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>

        <Section title="Застосування параметрів">
          <p className={textMuted} style={{ margin: 0, fontSize: 13 }}>
            Оцінка ефекту наперед не рахується: показано лише збережений стан набору.
          </p>
          <div className={panel} style={{ gap: 12, padding: "18px 20px", borderRadius: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span className={textSoft} style={{ fontSize: 13 }}>
                Збережено
              </span>
              <span
                style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
              >
                {saved?.updatedAt ? dateTime(saved.updatedAt) : "Ще не зберігали"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span className={textSoft} style={{ fontSize: 13 }}>
                Автор зміни
              </span>
              <span
                style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
              >
                {saved?.updatedByAppUserId ? shortId(saved.updatedByAppUserId) : "Типові значення"}
              </span>
            </div>
            <div style={{ height: 1, background: "var(--color-divider)" }} />
            <span className={textMuted} style={{ fontSize: 12 }}>
              Завершені запуски й ручні рішення по парах не переписуються.
            </span>
          </div>

          {problems.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className={panel}
              style={{ gap: 6, padding: "14px 16px", borderRadius: 8 }}
            >
              <span style={{ fontSize: 13, color: "var(--color-accent)" }}>
                Значення поза допустимими межами
              </span>
              <ul className={textSoft} style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {problems.map((problem) => (
                  <li key={`${problem.key}-${problem.text}`}>{problem.text}</li>
                ))}
              </ul>
            </div>
          )}

          {saveError && (
            <p
              role="alert"
              className={panel}
              style={{ margin: 0, padding: "14px 16px", borderRadius: 8, fontSize: 13 }}
            >
              {saveError}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className={`${primaryButton} btn-block`}
              style={{ marginTop: 0, height: 38 }}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Збереження…" : "Зберегти параметри"}
            </button>
            <button
              type="button"
              className={`${quietButton} btn-block`}
              style={{ marginTop: 0, height: 38 }}
              disabled={saving}
              onClick={reset}
            >
              Скинути до типових
            </button>
          </div>

          <p
            className={justSaved ? undefined : textMuted}
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.6,
              color: justSaved ? "var(--color-accent)" : undefined,
            }}
          >
            {justSaved
              ? "Збережено. Зміни застосуються з наступного запуску, а саме збереження записано з автором і часом."
              : "Зміни застосуються з наступного запуску. Кожне збереження записується з автором і часом."}
          </p>
        </Section>
      </div>
    </Page>
  );
}
