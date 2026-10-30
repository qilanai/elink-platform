export const newAPIHosted = import.meta.env.VITE_NEW_API_HOSTED === "true";

let expiresAt = 0;
let pending: Promise<void> | undefined;
let userId: number | undefined;
let sessionId: string | undefined;

export function subscribeNewAPISession(): () => void {
    if (!newAPIHosted || window.location.pathname.startsWith(`${import.meta.env.BASE_URL || "/"}share/canvas/`)) return () => {};
    const receive = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const event = value as { kind?: string; sid?: string; timestamp?: number };
        if (typeof event.timestamp !== "number" || Math.abs(Date.now() - event.timestamp) >= 60_000 || !event.sid) return;
        if (event.kind === "signed_out" || (event.kind === "authenticated" && event.sid !== sessionId)) {
            expiresAt = 0;
            window.location.reload();
        }
    };
    const focus = () => {
        // Tab switches must not rotate a still-valid session or retry a
        // temporary outage in a reload loop (refresh is rate limited).
        void ensureNewAPISession().catch(() => undefined);
    };
    window.addEventListener("focus", focus);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("new-api:auth-session") : undefined;
    if (channel) channel.onmessage = (event) => receive(event.data);
    const storage = (event: StorageEvent) => {
        if (event.key !== "new-api:auth-session:event" || !event.newValue) return;
        try {
            receive(JSON.parse(event.newValue));
        } catch {
            /* Invalid same-origin event. */
        }
    };
    window.addEventListener("storage", storage);
    return () => {
        channel?.close();
        window.removeEventListener("focus", focus);
        window.removeEventListener("storage", storage);
    };
}

// Refresh through the host's HttpOnly cookie. Neither URL nor browser storage
// carries a credential; the Studio cookie is checked by the gateway each time.
export function ensureNewAPISession(): Promise<void> {
    if (!newAPIHosted || expiresAt > Date.now() / 1000 + 60) return Promise.resolve();
    if (pending) return pending;
    const refresh = async () => {
        const response = await fetch("/api/user/auth/refresh", { method: "POST", credentials: "same-origin", headers: { "Cache-Control": "no-store" } });
        if (response.status === 401) {
            window.location.replace(`/sign-in?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            throw new Error("请先登录账号");
        }
        if (!response.ok) throw new Error("无法恢复登录状态，请重试");
        const result = await response.json();
        const bundle = result.data;
        if (result.success !== true || typeof bundle?.access_token !== "string" || !Number.isFinite(bundle?.access_expires_at) || !Number.isInteger(bundle.user?.id)) throw new Error("登录状态响应无效，请重试");
        if (userId !== undefined && userId !== bundle.user?.id) {
            window.location.reload();
            throw new Error("账号已切换，正在重新打开 Studio");
        }
        const session = await fetch(`${import.meta.env.VITE_CANVAS_BACKEND_URL}/auth/new-api-session`, {
            method: "POST",
            credentials: "same-origin",
            headers: { Authorization: `Bearer ${bundle.access_token}` },
        });
        if (!session.ok || (await session.json()).code !== 0) throw new Error("Studio 会话连接失败，请重试");
        expiresAt = bundle.access_expires_at;
        userId = bundle.user?.id;
        sessionId = bundle.session?.sid;
    };
    pending = (navigator.locks ? navigator.locks.request("new-api:auth-refresh", refresh) : refresh()).finally(() => {
        pending = undefined;
    });
    return pending;
}
