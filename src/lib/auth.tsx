import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Role, type AppUser } from "@clearmind/contracts/clearmind/v1/auth_pb";

import { createClients, createSessionStore, type Clients, type SessionStore } from "./clients";

export interface CurrentUser {
  id: string;
  username: string;
  role: Role;
}

function toCurrentUser(user: AppUser | undefined, fallbackUsername = ""): CurrentUser {
  return {
    id: user?.id ?? "",
    username: user?.username || fallbackUsername,
    role: user?.role ?? Role.UNSPECIFIED,
  };
}

export interface AuthValue {
  clients: Clients;
  user: CurrentUser | null;
  restoring: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ clients: provided, children }: { clients?: Clients; children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);

  const storeRef = useRef<SessionStore>();
  if (!storeRef.current) {
    storeRef.current = createSessionStore(() => setUser(null));
  }
  const store = storeRef.current;

  const [restoring, setRestoring] = useState(() => store.token !== "");
  const restoreStarted = useRef(false);

  const clients = useMemo(() => provided ?? createClients(store), [provided, store]);

  useEffect(() => {
    if (!restoring || restoreStarted.current) return;
    restoreStarted.current = true;

    clients.auth
      .getCurrentUser({})
      .then((response) => {
        if (response.user) {
          setUser(toCurrentUser(response.user));
        }
      })
      .catch(() => {
      })
      .finally(() => setRestoring(false));
  }, [clients, restoring]);

  const login = useCallback(
    async (username: string, password: string) => {
      const response = await clients.auth.login({ username, password });
      store.token = response.sessionToken;
      setUser(toCurrentUser(response.user, username));
    },
    [clients, store],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const response = await clients.auth.loginWithGoogle({ idToken });
      store.token = response.sessionToken;
      setUser(toCurrentUser(response.user));
    },
    [clients, store],
  );

  const logout = useCallback(async () => {
    try {
      await clients.auth.logout({});
    } finally {
      store.token = "";
      setUser(null);
    }
  }, [clients, store]);

  const value = useMemo<AuthValue>(
    () => ({
      clients,
      user,
      restoring,
      isAdmin: user?.role === Role.ADMIN,
      login,
      loginWithGoogle,
      logout,
    }),
    [clients, user, restoring, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth використано поза AuthProvider");
  }
  return value;
}
