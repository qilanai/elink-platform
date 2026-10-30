import type { Attachment, Message } from "../types";

export const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,.log,.ts,.tsx,.js,.jsx,.py,.go,.html,.css,.yaml,.yml,.xml,.sql,.sh";
export const MAX_ATTACHMENTS = 3;
const TEXT_LIMIT = 200 * 1024;
const IMAGE_LIMIT = 1024 * 1024;
const TOTAL_LIMIT = 2 * 1024 * 1024;
const textExtensions = new Set(ATTACHMENT_ACCEPT.split(",").slice(5));
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export async function readAttachment(file: File): Promise<Attachment> {
  const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
  const isImage = imageExtensions.has(extension);
  if (!isImage && !textExtensions.has(extension))
    throw new Error(
      `${file.name}：暂不支持此格式，请使用图片或 TXT、Markdown、CSV、代码等文本文件。`,
    );
  if (!file.size) throw new Error(`${file.name}：文件为空。`);
  if (file.size > (isImage ? IMAGE_LIMIT : TEXT_LIMIT))
    throw new Error(`${file.name}：${isImage ? "图片不能超过 1 MB" : "文本文件不能超过 200 KB"}。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base = { id: crypto.randomUUID(), name: file.name, size: file.size };
  if (isImage) {
    const signature = Array.from(bytes.slice(0, 12));
    let mime = "";
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => signature[i] === v)) mime = "image/png";
    else if (signature[0] === 255 && signature[1] === 216 && signature[2] === 255)
      mime = "image/jpeg";
    else if (/^GIF8[79]a/.test(new TextDecoder().decode(bytes.slice(0, 6)))) mime = "image/gif";
    else if (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    )
      mime = "image/webp";
    if (!mime) throw new Error(`${file.name}：图片格式无效。`);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`${file.name}：读取失败。`));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(new Blob([bytes], { type: mime }));
    });
    return { ...base, kind: "image", mime, data };
  }
  let data: string;
  try {
    data = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${file.name}：请先将文本转换为 UTF-8 编码。`);
  }
  if (data.includes("\0")) throw new Error(`${file.name}：文件包含二进制内容，无法作为文本读取。`);
  if (!data.trim()) throw new Error(`${file.name}：没有可读取的文本。`);
  return { ...base, kind: "text", mime: "text/plain", data };
}

export function validateAttachmentBatch(
  existing: Pick<Attachment, "size">[],
  incoming: Pick<File, "size">[],
): void {
  if (existing.length + incoming.length > MAX_ATTACHMENTS)
    throw new Error("每条消息最多添加 3 个附件。");
  if ([...existing, ...incoming].reduce((sum, file) => sum + file.size, 0) > TOTAL_LIMIT)
    throw new Error("每条消息的附件总大小不能超过 2 MB。");
}

export function messageContent(
  message: Message,
): string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] {
  const attachments = message.attachments || [];
  const text = [
    message.content,
    ...attachments
      .filter((a) => a.kind === "text")
      .map((a) => `\n附件 ${JSON.stringify(a.name)}：\n${a.data}`),
  ]
    .filter(Boolean)
    .join("\n");
  const images = attachments.filter((a) => a.kind === "image");
  if (!images.length) return text;
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.data } })),
  ];
}
