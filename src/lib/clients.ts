import {
  Code,
  ConnectError,
  createPromiseClient,
  type Interceptor,
  type PromiseClient,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { AccountService } from "@clearmind/contracts/clearmind/v1/account_connect";
import { AnalysisSettingsService } from "@clearmind/contracts/clearmind/v1/analysis_settings_connect";
import { AuthService } from "@clearmind/contracts/clearmind/v1/auth_connect";
import { ChannelCatalogService } from "@clearmind/contracts/clearmind/v1/channel_catalog_connect";
import { DuplicationService } from "@clearmind/contracts/clearmind/v1/duplication_connect";
import { IngestionService } from "@clearmind/contracts/clearmind/v1/ingestion_connect";
import { RecommendationService } from "@clearmind/contracts/clearmind/v1/recommendation_connect";
import { SubscriptionService } from "@clearmind/contracts/clearmind/v1/subscription_connect";

export interface Clients {
  auth: PromiseClient<typeof AuthService>;
  account: PromiseClient<typeof AccountService>;
  catalog: PromiseClient<typeof ChannelCatalogService>;
  subscription: PromiseClient<typeof SubscriptionService>;
  ingestion: PromiseClient<typeof IngestionService>;
  duplication: PromiseClient<typeof DuplicationService>;
  recommendation: PromiseClient<typeof RecommendationService>;
  analysisSettings: PromiseClient<typeof AnalysisSettingsService>;
}

export const SESSION_TOKEN_KEY = "clearmind.session-token";

function readStoredToken(): string {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredToken(token: string): void {
  try {
    if (token === "") {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    }
  } catch {
  }
}

export interface SessionStore {
  token: string;
  readonly onUnauthenticated: () => void;
}

export function createSessionStore(onUnauthenticated: () => void): SessionStore {
  let token = readStoredToken();

  return {
    get token() {
      return token;
    },
    set token(next: string) {
      token = next;
      writeStoredToken(next);
    },
    onUnauthenticated,
  };
}

export function sessionInterceptor(store: SessionStore): Interceptor {
  return (next) => async (request) => {
    if (store.token) {
      request.header.set("Authorization", `Bearer ${store.token}`);
    }

    try {
      return await next(request);
    } catch (cause) {
      if (ConnectError.from(cause).code === Code.Unauthenticated) {
        store.token = "";
        store.onUnauthenticated();
      }
      throw cause;
    }
  };
}

export function createClients(store?: SessionStore, baseUrl = ""): Clients {
  const transport = createConnectTransport({
    baseUrl,
    interceptors: store ? [sessionInterceptor(store)] : [],
  });

  return {
    auth: createPromiseClient(AuthService, transport),
    account: createPromiseClient(AccountService, transport),
    catalog: createPromiseClient(ChannelCatalogService, transport),
    subscription: createPromiseClient(SubscriptionService, transport),
    ingestion: createPromiseClient(IngestionService, transport),
    duplication: createPromiseClient(DuplicationService, transport),
    recommendation: createPromiseClient(RecommendationService, transport),
    analysisSettings: createPromiseClient(AnalysisSettingsService, transport),
  };
}
