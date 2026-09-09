import { Link } from "react-router-dom";

import { Page } from "../components/Page";
import { secondaryButton, textSoft } from "../lib/styles";

export function NotFoundScreen() {
  return (
    <Page>
      <div
        className="card elev-sm"
        style={{ padding: 32, gap: 12, alignItems: "flex-start", maxWidth: 620 }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-accent)",
          }}
        >
          404
        </span>

        <h1 style={{ margin: 0, fontSize: 25 }}>Такої сторінки немає</h1>

        <p
          className={textSoft}
          style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 440 }}
        >
          Перевірте адресу або поверніться до свого розділу — він відкриється відповідно до вашої
          ролі.
        </p>

        <Link to="/" className={secondaryButton} style={{ height: 38 }}>
          На початок
          <i className="ph ph-arrow-right" aria-hidden="true" />
        </Link>
      </div>
    </Page>
  );
}
