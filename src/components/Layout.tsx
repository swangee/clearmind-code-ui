import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { roleLabels } from "../lib/format";
import { quietButton, textMuted } from "../lib/styles";

interface NavItem {
  to: string;
  label: string;
}

const userNav: NavItem[] = [
  { to: "/import", label: "Імпорт" },
  { to: "/review", label: "Ревізія" },
  { to: "/recommendations", label: "Рекомендації" },
];

const adminNav: NavItem[] = [
  { to: "/catalog", label: "Каталог" },
  { to: "/pairs", label: "Пари" },
  { to: "/admin/recommendations", label: "Рекомендації" },
  { to: "/runs", label: "Запуски" },
  { to: "/settings", label: "Параметри" },
];

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const items = isAdmin ? adminNav : userNav;

  return (
    <div className="flex flex-col" style={{ minHeight: "var(--app-vh)" }}>
      <div className="nav app-nav sticky top-0 z-10">
        <span className="nav-brand">ClearMind</span>

        <nav aria-label="Основна навігація" className="flex items-center gap-4">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} style={{ fontSize: 14 }}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {user === null ? null : (
          <>
            <span className={textMuted} style={{ fontSize: 13, marginLeft: 16 }}>
              {user.username} · {roleLabels[user.role]}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className={quietButton}
              style={{ height: 30, fontSize: 13, padding: "0 10px" }}
            >
              <i className="ph ph-sign-out" aria-hidden="true" />
              Вийти
            </button>
          </>
        )}
      </div>

      <div
        style={{
          height: 1,
          background:
            "linear-gradient(to right,transparent,var(--color-divider) 48px,var(--color-divider) calc(100% - 48px),transparent)",
        }}
      />

      <main className="w-full" style={{ maxWidth: 1180 }}>
        <Outlet />
      </main>
    </div>
  );
}
