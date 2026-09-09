import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { Loading } from "../components/States";
import { useAuth } from "../lib/auth";
import { googleLoginErrorText, loginErrorText } from "../lib/errors";
import { alert, field, fieldGroup, primaryButton, quietButton } from "../lib/styles";

function dim(percent: number): string {
  return `color-mix(in srgb, var(--color-text) ${percent}%, transparent)`;
}

const featureCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  borderRadius: "var(--radius-md)",
  background: "var(--color-surface)",
  boxShadow: "var(--shadow-sm)",
};

const features = [
  {
    icon: "ph-copy-simple",
    title: "Роздільні сигнали, не один рейтинг",
    hint: "лексика, посилання, пересилання, час",
  },
  {
    icon: "ph-quotes",
    title: "Приклади збігів із обох каналів",
    hint: "із посиланням на конкретні публікації",
  },
  {
    icon: "ph-hand-palm",
    title: "Видно, що ви втратите",
    hint: "унікальні дописи каналу перед рішенням",
  },
];

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GoogleCredential {
  credential: string;
}

interface PromptMoment {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
}

interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredential) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  prompt: (listener?: (moment: PromptMoment) => void) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

let gisLoad: Promise<GoogleIdApi> | null = null;

function readGoogleId(): GoogleIdApi | undefined {
  return window.google?.accounts?.id;
}

function loadGoogleIdentity(): Promise<GoogleIdApi> {
  const ready = readGoogleId();
  if (ready) {
    return Promise.resolve(ready);
  }
  if (gisLoad) {
    return gisLoad;
  }

  gisLoad = new Promise<GoogleIdApi>((resolve, reject) => {
    const settle = () => {
      const api = readGoogleId();
      if (api) {
        resolve(api);
      } else {
        reject(new Error("Google Identity Services недоступний"));
      }
    };
    const fail = () => {
      gisLoad = null;
      reject(new Error("Google Identity Services не завантажився"));
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", settle);
      existing.addEventListener("error", fail);
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", settle);
    script.addEventListener("error", fail);
    document.head.appendChild(script);
  });

  return gisLoad;
}

function promptMissed(moment: PromptMoment): boolean {
  try {
    if (typeof moment.isNotDisplayed === "function" && moment.isNotDisplayed()) {
      return true;
    }
    if (typeof moment.isSkippedMoment === "function" && moment.isSkippedMoment()) {
      return true;
    }
  } catch {
  }
  return false;
}

interface AuthMethods {
  passwordEnabled: boolean;
  googleEnabled: boolean;
  googleClientId: string;
}

const PASSWORD_ONLY: AuthMethods = {
  passwordEnabled: true,
  googleEnabled: false,
  googleClientId: "",
};

export function LoginScreen() {
  const { user, clients, login, loginWithGoogle } = useAuth();
  const location = useLocation();
  const usernameRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleBroken, setGoogleBroken] = useState(false);
  const [googleHint, setGoogleHint] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [adminHint, setAdminHint] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    let active = true;
    clients.auth
      .getAuthMethods({})
      .then((response) => {
        if (!active) return;
        setMethods({
          passwordEnabled: response.passwordEnabled,
          googleEnabled: response.googleEnabled,
          googleClientId: response.googleClientId,
        });
      })
      .catch(() => {
        if (active) setMethods(PASSWORD_ONLY);
      });
    return () => {
      active = false;
    };
  }, [clients]);

  const acceptCredential = useCallback(
    async (credential: string) => {
      setGoogleBusy(true);
      setError("");
      try {
        await loginWithGoogle(credential);
      } catch (cause) {
        setError(googleLoginErrorText(cause));
      } finally {
        setGoogleBusy(false);
      }
    },
    [loginWithGoogle],
  );

  const googleConfigured =
    methods !== null && methods.googleEnabled && methods.googleClientId !== "";
  const clientId = methods?.googleClientId ?? "";

  useEffect(() => {
    if (!googleConfigured) return;

    let active = true;
    loadGoogleIdentity()
      .then((id) => {
        if (!active) return;
        id.initialize({
          client_id: clientId,
          callback: (response) => void acceptCredential(response.credential),
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });
        setGoogleReady(true);
      })
      .catch(() => {
        if (active) setGoogleBroken(true);
      });

    return () => {
      active = false;
      try {
        readGoogleId()?.cancel();
      } catch {
      }
    };
  }, [googleConfigured, clientId, acceptCredential]);

  useEffect(() => {
    if (focusTick > 0) {
      usernameRef.current?.focus();
    }
  }, [focusTick]);

  if (user) {
    return <Navigate to={from} replace state={{ afterLogin: true }} />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (cause) {
      setError(loginErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function startGoogle() {
    setError("");
    setGoogleHint("");

    const id = readGoogleId();
    if (!id) {
      setGoogleBroken(true);
      return;
    }

    id.prompt((moment) => {
      if (!promptMissed(moment)) return;
      setGoogleHint("Google не показав вікно входу. Скористайтеся формою нижче.");
      setPasswordOpen(true);
    });
  }

  const googleAvailable = googleConfigured && !googleBroken;
  const passwordAvailable = methods?.passwordEnabled ?? false;
  const passwordVisible = passwordAvailable && (!googleAvailable || passwordOpen);
  const formId = `${ids}-credentials`;

  function revealPassword() {
    setPasswordOpen(true);
    setAdminHint(true);
    setFocusTick((tick) => tick + 1);
  }

  const credentialsForm = passwordVisible ? (
    <form id={formId} onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <div className={fieldGroup}>
        <label htmlFor={`${ids}-username`}>Імʼя користувача</label>
        <input
          id={`${ids}-username`}
          ref={usernameRef}
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className={field}
        />
      </div>

      <div className={fieldGroup}>
        <label htmlFor={`${ids}-password`}>Пароль</label>
        <input
          id={`${ids}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
      </div>

      <button
        type="submit"
        disabled={busy || username === "" || password === ""}
        aria-busy={busy}
        className={`${primaryButton} btn-block`}
        style={{ marginTop: 0, height: 44, fontSize: 15 }}
      >
        <i
          className={
            busy ? "ph ph-circle-notch animate-spin motion-reduce:animate-none" : "ph ph-sign-in"
          }
          style={{ fontSize: 18 }}
          aria-hidden="true"
        />
        Увійти
      </button>
    </form>
  ) : null;

  return (
    <main
      className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]"
      style={{ minHeight: "var(--app-vh)", background: "var(--color-bg)" }}
    >
      <div
        className="flex flex-col justify-between gap-10"
        style={{ padding: "clamp(28px, 5vw, 56px) clamp(20px, 5vw, 64px)" }}
      >
        <div className="flex items-baseline gap-[10px]">
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: "var(--font-heading-weight)",
              fontSize: 19,
            }}
          >
            ClearMind
          </span>
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: dim(45),
            }}
          >
            ревізія підписок
          </span>
        </div>

        <div className="flex flex-col gap-5" style={{ maxWidth: 460 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 4.6vw, 46px)" }}>
            Хто з ваших каналів повторює інших
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: dim(75) }}>
            Сервіс порівнює публікації каналів, на які ви підписані, і показує стійке дублювання: що
            саме збігається, з якого джерела й у якій послідовності. Рішення про відписку ухвалюєте
            ви — ClearMind нічого не робить у Telegram від вашого імені.
          </p>

          <div
            className="flex flex-col gap-[10px]"
            style={{ width: 320, maxWidth: "100%", marginTop: 8 }}
          >
            {error === "" ? null : (
              <p role="alert" className={alert} style={{ padding: "10px 12px", margin: 0 }}>
                <span className="flex items-center gap-2">
                  <i
                    className="ph ph-warning"
                    style={{ color: "var(--color-accent)" }}
                    aria-hidden="true"
                  />
                  {error}
                </span>
              </p>
            )}

            {methods === null ? <Loading label="Готуємо спосіб входу…" /> : null}

            {googleAvailable ? (
              <button
                type="button"
                onClick={startGoogle}
                disabled={!googleReady || googleBusy}
                aria-busy={googleBusy}
                className={`${primaryButton} btn-block`}
                style={{ marginTop: 0, height: 44, fontSize: 15 }}
              >
                <i
                  className={
                    googleBusy || !googleReady
                      ? "ph ph-circle-notch animate-spin motion-reduce:animate-none"
                      : "ph ph-google-logo"
                  }
                  style={{ fontSize: 18 }}
                  aria-hidden="true"
                />
                Увійти через Google
              </button>
            ) : null}

            {googleHint === "" ? null : (
              <p
                aria-live="polite"
                style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: dim(65) }}
              >
                {googleHint}
              </p>
            )}

            {googleAvailable ? null : credentialsForm}

            {methods === null ? null : (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: dim(50) }}>
                {googleAvailable
                  ? "Google використовується лише для входу в ClearMind."
                  : "Обліковий запис ClearMind використовується лише для входу в ClearMind."}{" "}
                Доступу до вашого акаунта Telegram сервіс не отримує — список каналів ви
                завантажуєте самі на наступному кроці.
              </p>
            )}

            {passwordAvailable ? (
              <button
                type="button"
                onClick={revealPassword}
                aria-expanded={passwordVisible}
                aria-controls={formId}
                className={quietButton}
                style={{ height: 34, fontSize: 13, alignSelf: "flex-start", padding: "0 8px" }}
              >
                <i className="ph ph-shield-check" aria-hidden="true" />
                Вхід для адміністратора
              </button>
            ) : null}

            {googleAvailable ? credentialsForm : null}

            {adminHint ? (
              <p
                style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: dim(50) }}
                aria-live="polite"
              >
                Окремої форми для адміністратора немає: увійдіть службовим обліковим записом у ці
                самі поля — доступ до адміністративних розділів дає роль, видана сервером.
              </p>
            ) : null}

            {methods !== null && !passwordAvailable && !googleAvailable ? (
              <p role="alert" className={alert} style={{ padding: "10px 12px", margin: 0 }}>
                <span className="flex items-center gap-2">
                  <i
                    className="ph ph-warning"
                    style={{ color: "var(--color-accent)" }}
                    aria-hidden="true"
                  />
                  Жоден спосіб входу зараз не доступний. Оновіть сторінку або зверніться до
                  адміністратора.
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: dim(40) }}>
          Магістерський інженерний проєкт · MVP
        </p>
      </div>

      <div
        className="flex flex-col justify-center gap-[14px]"
        style={{
          padding: "clamp(28px, 5vw, 56px) clamp(20px, 5vw, 64px)",
          background:
            "linear-gradient(160deg, color-mix(in srgb, var(--color-accent-900) 40%, var(--color-bg)) 0%, var(--color-bg) 70%)",
        }}
      >
        {features.map((feature) => (
          <div key={feature.icon} style={featureCard}>
            <i
              className={`ph ${feature.icon}`}
              style={{ fontSize: 20, color: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span style={{ fontSize: 14 }}>{feature.title}</span>
              <span style={{ fontSize: 12, color: dim(50) }}>{feature.hint}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
