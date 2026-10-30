export const defaultLogo = "/brand/elink-nexus-logo.svg";

export async function loadHostLogo(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/status", { signal });
  if (!response.ok) return defaultLogo;
  const result = await response.json();
  const logo = result.success === true ? result.data?.logo : undefined;
  if (typeof logo !== "string" || !logo.trim()) return defaultLogo;
  const url = new URL(logo.trim(), window.location.origin);
  return url.protocol === "https:" || url.origin === window.location.origin
    ? url.href
    : defaultLogo;
}
