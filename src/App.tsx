import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

import { Layout } from "./components/Layout";
import { Loading } from "./components/States";
import { AuthProvider, useAuth } from "./lib/auth";
import type { Clients } from "./lib/clients";
import { AccountScreen } from "./screens/AccountScreen";
import { AdminRecommendationsScreen } from "./screens/AdminRecommendationsScreen";
import { AnalysisSettingsScreen } from "./screens/AnalysisSettingsScreen";
import { ChannelCatalogScreen } from "./screens/ChannelCatalogScreen";
import { ChannelDetailScreen } from "./screens/ChannelDetailScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { NotFoundScreen } from "./screens/NotFoundScreen";
import { PairsScreen } from "./screens/PairsScreen";
import { RecommendationsPage } from "./screens/RecommendationsPage";
import { ReviewScreen } from "./screens/ReviewScreen";
import { RunsScreen } from "./screens/RunsScreen";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function Forbidden() {
  const location = useLocation();
  const afterLogin = (location.state as { afterLogin?: boolean } | null)?.afterLogin === true;
  return afterLogin ? <Navigate to="/" replace /> : <NotFoundScreen />;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Forbidden />;
}

function RequireUser({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <Forbidden /> : <>{children}</>;
}

function AccountRoute({ clients }: { clients: Clients }) {
  const navigate = useNavigate();
  return (
    <AccountScreen
      clients={clients}
      onSnapshotCreated={(snapshotId) => navigate(`/runs?snapshot=${snapshotId}`)}
    />
  );
}

function IndexRoute() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? "/catalog" : "/review"} replace />;
}

function RestoringSession() {
  return (
    <main
      className="flex items-center justify-center"
      style={{ minHeight: "var(--app-vh)", background: "var(--color-bg)" }}
    >
      <Loading label="Відновлюємо сесію…" />
    </main>
  );
}

function Screens() {
  const { clients, isAdmin, restoring } = useAuth();

  if (restoring) {
    return <RestoringSession />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<IndexRoute />} />

        <Route
          path="import"
          element={
            <RequireUser>
              <ImportScreen clients={clients} />
            </RequireUser>
          }
        />
        <Route
          path="review"
          element={
            <RequireUser>
              <ReviewScreen clients={clients} />
            </RequireUser>
          }
        />
        <Route path="recommendations" element={<RecommendationsPage clients={clients} />} />
        <Route path="account" element={<AccountRoute clients={clients} />} />

        <Route
          path="catalog"
          element={
            <RequireAdmin>
              <ChannelCatalogScreen clients={clients} isAdmin={isAdmin} />
            </RequireAdmin>
          }
        />
        <Route
          path="channels/:channelId"
          element={<ChannelDetailScreen clients={clients} isAdmin={isAdmin} />}
        />
        <Route
          path="pairs"
          element={
            <RequireAdmin>
              <PairsScreen clients={clients} />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/recommendations"
          element={
            <RequireAdmin>
              <AdminRecommendationsScreen clients={clients} />
            </RequireAdmin>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAdmin>
              <AnalysisSettingsScreen clients={clients} />
            </RequireAdmin>
          }
        />
        <Route
          path="runs"
          element={
            <RequireAdmin>
              <RunsScreen clients={clients} />
            </RequireAdmin>
          }
        />
        <Route
          path="events"
          element={
            <RequireAdmin>
              <EventsScreen clients={clients} />
            </RequireAdmin>
          }
        />

        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}

export function App({ clients }: { clients?: Clients } = {}) {
  return (
    <AuthProvider clients={clients}>
      <Screens />
    </AuthProvider>
  );
}
