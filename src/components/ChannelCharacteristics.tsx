import type { CatalogChannel } from "@clearmind/contracts/clearmind/v1/channel_catalog_pb";

import { percent } from "../lib/format";
import { textFaint, textSoft } from "../lib/styles";

export function ChannelCharacteristics({
  channel,
  pendingLabel = "ще немає даних",
}: {
  channel: CatalogChannel;
  pendingLabel?: string;
}) {
  if (!channel.hasProfile || !channel.profile) {
    return <span className="tag tag-outline">{pendingLabel}</span>;
  }

  const profile = channel.profile;

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap gap-x-6 gap-y-1" style={{ fontSize: 13 }}>
        <Stat label="Публікацій" value={String(profile.postCount)} />
        <Stat label="На добу" value={profile.postsPerDay.toFixed(1)} />
        <Stat label="Унікального" value={percent(profile.uniqueContentShare)} />
      </dl>
      {profile.topDomains.length === 0 ? null : (
        <p className={`m-0 ${textFaint}`} style={{ fontSize: 12 }}>
          Провідні домени:{" "}
          {profile.topDomains
            .map((domain) => `${domain.domain} (${percent(domain.share)})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className={textSoft}>{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  );
}
