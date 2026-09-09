import type { ReactNode } from "react";

import type { RunFailure } from "@clearmind/contracts/clearmind/v1/common_pb";

import { runFailureLabels } from "../lib/format";
import { secondaryButton, textMuted, textSoft } from "../lib/styles";

export function Loading({ label = "Завантаження…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 py-8 text-sm ${textMuted}`}
    >
      <i className="ph ph-circle-notch animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({
  title,
  note,
  hint,
  action,
}: {
  title: string;
  note?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card elev-sm" style={{ padding: "28px 20px" }}>
      <span style={{ fontSize: 15 }}>{title}</span>
      {note === undefined ? null : (
        <span className={textSoft} style={{ fontSize: 14, lineHeight: 1.5 }}>
          {note}
        </span>
      )}
      {hint === undefined ? null : (
        <span className={textMuted} style={{ fontSize: 13, marginTop: note === undefined ? 0 : 4 }}>
          {hint}
        </span>
      )}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card elev-sm" style={{ padding: "20px" }}>
      <div className="flex items-center gap-2">
        <i className="ph ph-warning" style={{ color: "var(--color-accent)" }} aria-hidden="true" />
        <span style={{ fontSize: 15 }}>Не вдалося завантажити дані</span>
      </div>
      <p className={`m-0 ${textSoft}`} style={{ fontSize: 13 }}>
        {message}
      </p>
      {onRetry === undefined ? null : (
        <button type="button" onClick={onRetry} className={secondaryButton} style={{ alignSelf: "flex-start" }}>
          Повторити
        </button>
      )}
    </div>
  );
}

export function RunFailureNote({ failure }: { failure?: RunFailure }) {
  if (!failure) return null;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--color-bg)",
      }}
    >
      <i
        className="ph ph-warning-circle"
        aria-hidden="true"
        style={{ fontSize: 16, color: "var(--color-accent)", marginTop: 1 }}
      />
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        {runFailureLabels[failure.code]}
        {failure.message ? `. ${failure.message}` : "."}
      </span>
    </div>
  );
}
