import { getPublicAppearance, type PublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } from "@/stores/use-appearance-store";
import { newAPIHosted } from "@/services/new-api-session";

const APPEARANCE_BOOTSTRAP_TIMEOUT_MS = 4_000;
let refreshing: Promise<PublicAppearance | undefined> | undefined;

async function getIntegratedAppearance(signal: AbortSignal): Promise<PublicAppearance> {
    if (!newAPIHosted) return getPublicAppearance(signal);
    const [appearance, status] = await Promise.all([
        getPublicAppearance(signal).catch(() => DEFAULT_PUBLIC_APPEARANCE),
        fetch("/api/status", { signal }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined),
    ]);
    let logo = "/brand/elink-nexus-logo.svg";
    const configured = status?.success === true ? status.data?.logo : undefined;
    if (typeof configured === "string" && configured.trim()) {
        try {
            const url = new URL(configured.trim(), window.location.origin);
            if (url.protocol === "https:" || url.origin === window.location.origin) logo = url.href;
        } catch { /* Keep the host's bundled brand when the configured URL is invalid. */ }
    }
    return { ...appearance, logoUrl: logo, darkLogoUrl: logo, logoConfigured: true, darkLogoConfigured: true, logoFrameEnabled: false };
}

// A failed refresh must keep the last saved identity rather than restore defaults.
export function refreshPublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getIntegratedAppearance) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const previous = useAppearanceStore.getState().appearance;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
        try {
            const appearance = await fetchAppearance(controller.signal);
            if (useAppearanceStore.getState().appearance !== previous) return undefined;
            return commitPublicAppearance(appearance);
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    })().finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export async function resolvePublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getIntegratedAppearance) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
    try {
        return await fetchAppearance(controller.signal);
    } catch {
        return DEFAULT_PUBLIC_APPEARANCE;
    } finally {
        clearTimeout(timer);
    }
}

export async function bootstrapAppearance(fetchAppearance?: (signal: AbortSignal) => Promise<PublicAppearance>) {
    return commitPublicAppearance(await resolvePublicAppearance(fetchAppearance));
}
