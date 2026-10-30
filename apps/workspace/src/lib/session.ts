const REFRESH_RACE_DELAYS = [80, 200, 500] as const;

export type SessionErrorKind = "none" | "unauthorized" | "rate_limited" | "network";

let accessToken = "";
let expiresAt = 0;
let userId: number | undefined;
let sessionId: string | undefined;
let authState: "unknown" | "authenticated" | "anonymous" = "unknown";
let lastError: SessionErrorKind = "none";
let rateLimitedUntil = 0;
let pending: Promise<string | null> | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getNewAPIAccessToken(): string {
  return accessToken;
}

export function getNewAPISessionRetryAt(): number {
  return rateLimitedUntil;
}

export function getNewAPISessionError(): SessionErrorKind {
  return lastError;
}

function applySessionToken(token: string, exp: number, uid?: number, sid?: string): string {
  if (userId !== undefined && uid !== undefined && userId !== uid) {
    window.location.reload();
    return "";
  }
  accessToken = token;
  expiresAt = exp;
  if (uid !== undefined && Number.isInteger(uid)) {
    userId = uid;
  }
  if (typeof sid === "string" && sid) {
    sessionId = sid;
  }
  authState = "authenticated";
  lastError = "none";
  return accessToken;
}

function requestSessionFromParentFrame(timeoutMs = 250): Promise<string | null> {
  if (typeof window === "undefined" || !window.parent || window.parent === window) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(token);
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      if (!event.data || typeof event.data !== "object") return;
      const data = event.data as {
        type?: unknown;
        accessToken?: unknown;
        expiresAt?: unknown;
        userId?: unknown;
        sessionId?: unknown;
      };
      if (
        data.type === "new-api:ext-chat:session" &&
        typeof data.accessToken === "string" &&
        data.accessToken.length > 0 &&
        typeof data.expiresAt === "number" &&
        Number.isFinite(data.expiresAt)
      ) {
        const applied = applySessionToken(
          data.accessToken,
          data.expiresAt,
          typeof data.userId === "number" ? data.userId : undefined,
          typeof data.sessionId === "string" ? data.sessionId : undefined,
        );
        finish(applied || null);
      }
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage(
        { type: "new-api:ext-chat:request-session" },
        window.location.origin,
      );
    } catch {
      finish(null);
    }
  });
}

export function subscribeNewAPISession(onSessionChange?: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const receive = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as { kind?: string; sid?: string; timestamp?: number };
    if (
      typeof event.timestamp !== "number" ||
      Math.abs(Date.now() - event.timestamp) >= 60_000 ||
      !event.sid
    ) {
      return;
    }
    if (event.kind === "signed_out") {
      accessToken = "";
      expiresAt = 0;
      authState = "anonymous";
      lastError = "unauthorized";
      if (onSessionChange) {
        onSessionChange();
      } else {
        window.location.reload();
      }
      return;
    }
    if (event.kind === "authenticated" && event.sid !== sessionId) {
      accessToken = "";
      expiresAt = 0;
      authState = "unknown";
      lastError = "none";
      rateLimitedUntil = 0;
      if (onSessionChange) {
        onSessionChange();
      } else {
        window.location.reload();
      }
    }
  };

  const onParentMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    if (!window.parent || event.source !== window.parent) return;
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data as {
      type?: unknown;
      accessToken?: unknown;
      expiresAt?: unknown;
      userId?: unknown;
      sessionId?: unknown;
    };
    if (
      data.type === "new-api:ext-chat:session" &&
      typeof data.accessToken === "string" &&
      data.accessToken.length > 0 &&
      typeof data.expiresAt === "number" &&
      Number.isFinite(data.expiresAt)
    ) {
      const wasUnauthenticated = authState !== "authenticated";
      applySessionToken(
        data.accessToken,
        data.expiresAt,
        typeof data.userId === "number" ? data.userId : undefined,
        typeof data.sessionId === "string" ? data.sessionId : undefined,
      );
      if (wasUnauthenticated && onSessionChange) {
        onSessionChange();
      }
    }
  };

  const focus = () => {
    if (authState !== "authenticated") return;
    if (Date.now() < rateLimitedUntil) return;
    if (accessToken && expiresAt > Date.now() / 1000 + 60) return;
    void ensureNewAPISession().catch(() => undefined);
  };

  window.addEventListener("focus", focus);
  window.addEventListener("message", onParentMessage);
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("new-api:auth-session")
      : undefined;
  if (channel) {
    channel.onmessage = (event) => receive(event.data);
  }

  const storage = (event: StorageEvent) => {
    if (event.key !== "new-api:auth-session:event" || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      /* ignore invalid event */
    }
  };
  window.addEventListener("storage", storage);

  return () => {
    channel?.close();
    window.removeEventListener("focus", focus);
    window.removeEventListener("message", onParentMessage);
    window.removeEventListener("storage", storage);
  };
}

async function requestRefreshToken(
  raceAttempt = 0,
  allowMismatchRetry = true,
): Promise<string | null> {
  if (Date.now() < rateLimitedUntil) {
    return accessToken || null;
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-cache, no-store",
  };
  if (sessionId) {
    headers["X-Auth-Session"] = sessionId;
  }

  const response = await fetch("/api/user/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const code = typeof payload?.code === "string" ? payload.code : undefined;
  const bundle = payload?.data;

  if (
    response.ok &&
    payload?.success === true &&
    typeof bundle?.access_token === "string" &&
    bundle.access_token.length > 0 &&
    Number.isFinite(bundle?.access_expires_at)
  ) {
    const applied = applySessionToken(
      bundle.access_token,
      Number(bundle.access_expires_at),
      Number.isInteger(bundle?.user?.id) ? Number(bundle.user.id) : undefined,
      typeof bundle?.session?.sid === "string" ? bundle.session.sid : undefined,
    );
    return applied || null;
  }

  if (response.status === 409 && code === "AUTH_REFRESH_RACE") {
    const delay = REFRESH_RACE_DELAYS[raceAttempt];
    if (delay !== undefined) {
      await sleep(delay);
      return requestRefreshToken(raceAttempt + 1, allowMismatchRetry);
    }
  }

  if (response.status === 409 && code === "AUTH_SESSION_MISMATCH" && allowMismatchRetry) {
    accessToken = "";
    expiresAt = 0;
    sessionId = undefined;
    authState = "unknown";
    return requestRefreshToken(0, false);
  }

  if (response.status === 429) {
    const retryAfterHeader = Number(response.headers.get("Retry-After") || 0);
    const backoffSeconds =
      Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader
        : 15;
    rateLimitedUntil = Date.now() + backoffSeconds * 1000;
    lastError = "rate_limited";
    return accessToken || null;
  }

  if (response.status === 401 || response.status === 403) {
    accessToken = "";
    expiresAt = 0;
    userId = undefined;
    sessionId = undefined;
    authState = "anonymous";
    lastError = "unauthorized";
    return null;
  }

  lastError = "network";
  return accessToken || null;
}

export function ensureNewAPISession(force = false): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (!force && accessToken && expiresAt > Date.now() / 1000 + 60) {
    return Promise.resolve(accessToken);
  }
  if (!force && authState === "anonymous") {
    return Promise.resolve(null);
  }
  if (Date.now() < rateLimitedUntil) {
    return Promise.resolve(accessToken || null);
  }
  // This protected app must ask the host even when the optional public-page
  // hint cookie is absent. Only the refresh endpoint can declare a session invalid.
  if (pending) {
    return pending;
  }

  const run = async (): Promise<string | null> => {
    if (!force && accessToken && expiresAt > Date.now() / 1000 + 60) {
      return accessToken;
    }
    const parentToken = await requestSessionFromParentFrame();
    if (parentToken) {
      return parentToken;
    }
    return requestRefreshToken();
  };

  const lockPromise =
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("new-api:auth-refresh", { mode: "exclusive" }, run)
      : run();

  pending = lockPromise
    .catch(() => {
      lastError = "network";
      return accessToken || null;
    })
    .finally(() => {
      pending = undefined;
    });

  return pending;
}
