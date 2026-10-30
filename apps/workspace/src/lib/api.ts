import { messageContent } from "./attachments";
import { ensureNewAPISession, getNewAPISessionError, getNewAPISessionRetryAt } from "./session";
import type { Bootstrap, ChatModel, ChatToken, Message } from "../types";

export class SessionExpiredError extends Error {
  constructor() {
    super("登录已过期，请返回主站重新登录。");
  }
}

export class SessionRetryError extends Error {
  constructor(public readonly retryAt: number) {
    super("登录状态校验暂时受限，工作台会在限制解除后自动重试。");
  }
}

async function sessionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureNewAPISession();
  if (!token) {
    const error = getNewAPISessionError();
    if (error === "rate_limited") throw new SessionRetryError(getNewAPISessionRetryAt());
    if (error === "network") throw new Error("暂时无法连接主站，请检查网络后刷新重试。");
    throw new SessionExpiredError();
  }
  const response = await fetch(`/api/ext/apps/chat${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401 && !path.startsWith("/relay/")) throw new SessionExpiredError();
  if (response.status === 403) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null);
    if (payload?.code === "AUTH_SESSION_REQUIRED") throw new SessionExpiredError();
    throw new Error(payload?.error?.message || "当前 API 密钥无权执行此请求，请检查密钥权限。");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message || payload?.message || `请求失败（${response.status}）`,
    );
  }
  return response;
}

export async function fetchChatTokens(): Promise<ChatToken[]> {
  const items: ChatToken[] = [];
  for (let page = 0; ; page++) {
    const payload = await (await sessionFetch(`/tokens?page=${page}`)).json();
    if (!payload.success || !Array.isArray(payload.data?.items)) throw new Error("无法读取 API 密钥");
    items.push(...payload.data.items);
    if (!payload.data.has_more) return items;
  }
}

export async function fetchTokenModels(tokenId: number): Promise<{ models: string[]; group: string }> {
  const payload = await (await sessionFetch("/relay/v1/models", {
    headers: { "X-New-API-Token-ID": String(tokenId) },
  })).json();
  if (!Array.isArray(payload.data)) throw new Error("无法读取密钥的模型权限");
  return { models: payload.data.map((m: { id: string }) => m.id), group: payload.group };
}

export async function bootstrap(): Promise<Bootstrap> {
  const response = await sessionFetch("/bootstrap");
  const payload = await response.json();
  if (!payload.success || !Number.isInteger(payload.data?.user_id))
    throw new Error("无法读取主站账号");
  const catalog = await (await sessionFetch("/catalog")).json();
  if (!catalog.success || !Array.isArray(catalog.data)) throw new Error("无法读取模型目录");
  const userGroup = payload.data.user?.group || "default";
  // Capabilities and concrete groups come exclusively from the host catalog.
  const available: ChatModel[] = catalog.data
    .filter((m: { id: string; endpoint_paths?: string[] }) =>
      m.endpoint_paths?.includes("/v1/chat/completions"),
    )
    .map((m: ChatModel) => ({ id: m.id, groups: m.groups || [userGroup] }))
    .filter((m: ChatModel) => m.groups.length > 0);
  const group = userGroup;
  const models = available.filter((m) => m.groups.includes(group)).map((m) => m.id);
  return {
    user_id: payload.data.user_id,
    username: payload.data.username,
    models,
    catalog: available,
    group,
  };
}

export async function readCompletionStream(
  response: Response,
  onText: (text: string) => void,
  onReasoning: (text: string) => void = () => {},
): Promise<void> {
  if (!response.body) throw new Error("服务器没有返回响应内容");
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "生成失败");
    const reply = payload.choices?.[0]?.message;
    if (typeof reply?.reasoning_content === "string") onReasoning(reply.reasoning_content);
    const text = reply?.content || reply?.refusal;
    if (typeof text !== "string" || !text.trim())
      throw new Error("模型未返回正文，请检查模型或渠道后重试。");
    onText(text);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let hasText = false;
  let finishReason = "";
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // Normalize after concatenation so CRLF can straddle network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          completed = true;
          break;
        }
        const payload = JSON.parse(data);
        if (payload.error) throw new Error(payload.error.message || "生成失败");
        const choice = payload.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content || choice?.delta?.refusal;
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === "string") onReasoning(reasoning);
        if (typeof delta === "string") {
          if (delta.trim()) hasText = true;
          onText(delta);
        }
      }
      if (done) {
        if (!completed) throw new Error("连接提前中断，已保留收到的内容，请检查后重试。");
        break;
      }
    }
    if (!hasText)
      throw new Error(
        finishReason === "length"
          ? "模型达到输出上限但未返回正文，请调整模型或输出限制后重试。"
          : "模型未返回正文，请检查模型或渠道后重试。",
      );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function complete(
  model: string,
  messages: Message[],
  systemRole: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  group?: string,
  onReasoning?: (text: string) => void,
  tokenId?: number,
): Promise<void> {
  if (!tokenId) throw new Error("请选择 API 密钥后发送。");
  const history = messages
    .filter((m) => !m.error && (m.content.trim() || m.attachments?.length))
    .map((m) => ({ role: m.role as string, content: messageContent(m) }));
  if (systemRole.trim()) history.unshift({ role: "system", content: systemRole.trim() });
  // Never retry a generation automatically: an uncertain result may already be billed.
  const response = await sessionFetch("/relay/v1/chat/completions", {
    method: "POST",
    headers: { "X-New-API-Token-ID": String(tokenId) },
    signal,
    body: JSON.stringify({ model, messages: history, stream: true }),
  });
  await readCompletionStream(response, onText, onReasoning);
}
