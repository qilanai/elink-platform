import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let instance = 0;
let session: typeof import("../src/lib/session");
let request: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let clock: ReturnType<typeof spyOn<DateConstructor, "now">>;

function validSession() {
  return Response.json({
    success: true,
    data: {
      access_token: "test-only-session",
      access_expires_at: Math.floor(Date.now() / 1000) + 900,
      user: { id: 12 },
      session: { sid: "test-session-12" },
    },
  });
}

beforeEach(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { parent: null } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  request = spyOn(globalThis, "fetch");
  clock = spyOn(Date, "now");
  // Each test represents a fresh tab with its own in-memory session.
  const modulePath = `../src/lib/session.ts?test-tab=${++instance}`;
  session = await import(modulePath);
});

afterEach(() => {
  request.mockRestore();
  clock.mockRestore();
  for (const [name, descriptor] of [["window", originalWindow], ["document", originalDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("a fresh tab restores the host session without the optional hint cookie", async () => {
  request.mockResolvedValue(validSession());
  expect(await session.ensureNewAPISession()).toBe("test-only-session");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe("/api/user/auth/refresh");
  expect(request.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  expect(session.getNewAPISessionError()).toBe("none");
  // Subsequent calls and the catalog request reuse memory, without rotating cookies.
  expect(await session.ensureNewAPISession()).toBe("test-only-session");
  expect(request).toHaveBeenCalledTimes(1);
});

test("concurrent startup requests share one refresh", async () => {
  request.mockResolvedValue(validSession());
  expect(await Promise.all([session.ensureNewAPISession(), session.ensureNewAPISession()]))
    .toEqual(["test-only-session", "test-only-session"]);
  expect(request).toHaveBeenCalledTimes(1);
});

test("only a server rejection marks the tab unauthenticated", async () => {
  request.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await session.ensureNewAPISession()).toBeNull();
  expect(session.getNewAPISessionError()).toBe("unauthorized");
  expect(await session.ensureNewAPISession()).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

test("429 honours the entire Retry-After window, then restores the same login", async () => {
  const now = Date.now();
  clock.mockReturnValue(now);
  request.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "1200" } }));
  expect(await session.ensureNewAPISession()).toBeNull();
  expect(session.getNewAPISessionError()).toBe("rate_limited");
  expect(session.getNewAPISessionRetryAt()).toBe(now + 1_200_000);
  clock.mockReturnValue(now + 61_000);
  expect(await session.ensureNewAPISession(true)).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(now + 1_200_001);
  request.mockResolvedValue(validSession());
  expect(await session.ensureNewAPISession()).toBe("test-only-session");
  expect(session.getNewAPISessionError()).toBe("none");
});

test("network failure allows retry instead of recording an expired login", async () => {
  request.mockRejectedValueOnce(new TypeError("Network unavailable"));
  expect(await session.ensureNewAPISession()).toBeNull();
  expect(session.getNewAPISessionError()).toBe("network");
  request.mockResolvedValue(validSession());
  expect(await session.ensureNewAPISession()).toBe("test-only-session");
});

test("session mismatch drops the stale SID and retries only once", async () => {
  request.mockResolvedValue(validSession());
  await session.ensureNewAPISession();
  request.mockResolvedValue(Response.json({ code: "AUTH_SESSION_MISMATCH" }, { status: 409 }));
  expect(await session.ensureNewAPISession(true)).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[1]?.[1]?.headers).toHaveProperty("X-Auth-Session", "test-session-12");
  expect(request.mock.calls[2]?.[1]?.headers).not.toHaveProperty("X-Auth-Session");
  expect(session.getNewAPISessionError()).toBe("network");
});
