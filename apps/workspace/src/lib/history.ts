import type { Conversation } from "../types";

export function historyKey(userId: number): string {
  return `elink-lobehub:v1:${userId}`;
}

export function loadHistory(storage: Pick<Storage, "getItem">, userId: number): Conversation[] {
  const raw = storage.getItem(historyKey(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.title === "string" &&
        typeof c.model === "string" &&
        (c.group === undefined || typeof c.group === "string") &&
        typeof c.systemRole === "string" &&
        typeof c.updatedAt === "number" &&
        Array.isArray(c.messages) &&
        c.messages.every(
          (m: Record<string, unknown>) =>
            m &&
            typeof m.id === "string" &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            typeof m.createdAt === "number" &&
            Number.isFinite(m.createdAt) &&
            (m.reasoning === undefined || typeof m.reasoning === "string") &&
            (m.attachments === undefined ||
              (Array.isArray(m.attachments) &&
                m.attachments.every(
                  (a: Record<string, unknown>) =>
                    a &&
                    typeof a.id === "string" &&
                    typeof a.name === "string" &&
                    typeof a.size === "number" &&
                    typeof a.mime === "string" &&
                    typeof a.data === "string" &&
                    (a.kind === "text" ||
                      (a.kind === "image" &&
                        /^data:image\/(png|jpeg|webp|gif);base64,/.test(a.data))),
                ))),
        ),
    )
  )
    throw new Error("本地历史记录格式异常，原始数据已保留，请检查浏览器存储。");
  return parsed;
}

export function saveHistory(
  storage: Pick<Storage, "setItem">,
  userId: number,
  items: Conversation[],
): void {
  storage.setItem(historyKey(userId), JSON.stringify(items));
}

export function newConversation(model: string, group?: string): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    model,
    group,
    systemRole: "",
    messages: [],
    updatedAt: Date.now(),
  };
}
