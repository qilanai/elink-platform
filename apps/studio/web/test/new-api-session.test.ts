import { expect, test } from "bun:test";

test("hosted session coalesces startup requests and does not rotate on tab switches", async () => {
    process.env.VITE_NEW_API_HOSTED = "true";
    process.env.BASE_URL = "/apps/studio/";
    process.env.VITE_CANVAS_BACKEND_URL = "/apps/studio/api";
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalFetch = globalThis.fetch;
    const listeners = new Map<string, () => void>();
    let refreshes = 0;
    let handshakes = 0;
    let reloads = 0;
    let disconnect = () => {};
    try {
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                location: { pathname: "/apps/studio/canvas", search: "", reload: () => reloads++, replace: () => reloads++ },
                addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
                removeEventListener: (name: string) => listeners.delete(name),
            },
        });
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
        globalThis.fetch = (async (url, options) => {
            if (url === "/api/user/auth/refresh") {
                refreshes++;
                expect(options?.credentials).toBe("same-origin");
                return Response.json({ success: true, data: { access_token: "short-session", access_expires_at: Date.now() / 1000 + 600, user: { id: 42 }, session: { sid: "session-id" } } });
            }
            expect(url).toBe("/apps/studio/api/auth/new-api-session");
            expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer short-session");
            handshakes++;
            return Response.json({ code: 0 });
        }) as typeof fetch;
        const modulePath = "../src/services/new-api-session.ts?hosted-session-regression";
        const session = await import(modulePath);
        await Promise.all(Array.from({ length: 12 }, () => session.ensureNewAPISession()));
        disconnect = session.subscribeNewAPISession();
        for (let i = 0; i < 30; i++) listeners.get("focus")?.();
        await Promise.resolve();
        expect(refreshes).toBe(1);
        expect(handshakes).toBe(1);
        expect(reloads).toBe(0);
    } finally {
        disconnect();
        globalThis.fetch = originalFetch;
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
        else Reflect.deleteProperty(globalThis, "navigator");
        delete process.env.VITE_NEW_API_HOSTED;
        delete process.env.VITE_CANVAS_BACKEND_URL;
        delete process.env.BASE_URL;
    }
});
