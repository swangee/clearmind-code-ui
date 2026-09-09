import type { EvidenceBundle } from "@clearmind/contracts/clearmind/v1/duplication_pb";

import { duration, percent, percentWidth, shortId, signalLabels } from "../lib/format";
import { textFaint, textSoft } from "../lib/styles";

export function EvidencePanel({ evidence }: { evidence: EvidenceBundle }) {
  return (
    <div className="flex flex-col" style={{ gap: 18 }}>
      <div className="hr" style={{ margin: 0 }} />

      <section aria-labelledby="signals-heading" className="flex flex-col gap-2.5">
        <h6 id="signals-heading" className={`m-0 ${textSoft}`}>
          Сигнали
        </h6>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          {evidence.signals.map((signal) => (
            <div key={signal.signal} className="flex flex-col gap-1.5">
              <div className="flex justify-between" style={{ fontSize: 13 }}>
                <span>{signalLabels[signal.signal]}</span>
                <span className="tabular-nums" style={{ color: "var(--color-accent)" }}>
                  {percent(signal.value)}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
                }}
              >
                <div
                  style={{
                    width: percentWidth(signal.value),
                    height: 3,
                    borderRadius: 2,
                    background: "var(--color-accent)",
                  }}
                />
              </div>
              <span className={textFaint} style={{ fontSize: 11 }}>
                {signal.explanation} Вибірка: {signal.sampleSize}.
              </span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="risk-heading" className="flex flex-col gap-2.5">
        <h6 id="risk-heading" className={`m-0 ${textSoft}`}>
          Унікальність і ризик
        </h6>
        <dl className="m-0 grid gap-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <Stat label="Унікальне зліва" value={percent(evidence.leftUniqueShare)} />
          <Stat label="Унікальне справа" value={percent(evidence.rightUniqueShare)} />
          <Stat label="Ризик втрати" value={percent(evidence.contentLossRisk)} />
          <Stat label="Частота збігів" value={percent(evidence.matchRate)} />
        </dl>
        <span className={textFaint} style={{ fontSize: 12 }}>
          Раніше публікує канал {shortId(evidence.earlierChannelId)}, типова затримка —{" "}
          {duration(evidence.medianDelaySeconds)}.
        </span>
      </section>

      <section aria-labelledby="samples-heading" className="flex flex-col gap-2.5">
        <h6 id="samples-heading" className={`m-0 ${textSoft}`}>
          Приклади збігів
        </h6>
        {evidence.samples.length === 0 ? (
          <span className={textFaint} style={{ fontSize: 13 }}>Прикладів немає.</span>
        ) : (
          <div className="flex flex-col gap-2.5">
            {evidence.samples.map((sample) => (
              <div
                key={`${sample.leftChannelId}:${sample.leftPostForeignId}-${sample.rightChannelId}:${sample.rightPostForeignId}`}
                className="flex flex-col gap-2"
              >
                <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <Excerpt
                    channel={shortId(sample.leftChannelId)}
                    post={sample.leftPostForeignId}
                    text={sample.leftExcerpt}
                  />
                  <Excerpt
                    channel={shortId(sample.rightChannelId)}
                    post={sample.rightPostForeignId}
                    text={sample.rightExcerpt}
                  />
                </div>
                <span className={textFaint} style={{ fontSize: 11 }}>
                  Схожість: {percent(sample.similarity)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className={textFaint} style={{ fontSize: 11 }}>{label}</dt>
      <dd className="m-0 tabular-nums" style={{ fontSize: 15 }}>
        {value}
      </dd>
    </div>
  );
}

function Excerpt({ channel, post, text }: { channel: string; post: string; text: string }) {
  return (
    <div
      style={{ padding: "10px 12px", borderRadius: 8, background: "var(--color-surface)" }}
      className="flex flex-col gap-1"
    >
      <span className={textFaint} style={{ fontSize: 11 }}>
        Канал {channel}, допис {post}
      </span>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  );
}
