import { expect, test } from "bun:test";
import { messageContent, readAttachment, validateAttachmentBatch } from "../src/lib/attachments";
import { readCompletionStream } from "../src/lib/api";
import type { Attachment, Message } from "../src/types";

test("reads UTF-8 documents without losing their name or contents and rejects binary or unsupported files", async () => {
  const attachment = await readAttachment(new File(["项目计划\n第一步"], "plan.md"));
  expect(attachment).toMatchObject({ name: "plan.md", kind: "text", data: "项目计划\n第一步" });
  await expect(readAttachment(new File(["pdf"], "report.pdf"))).rejects.toThrow("暂不支持");
  await expect(readAttachment(new File(["binary\0"], "fake.txt"))).rejects.toThrow("二进制");
  await expect(
    readAttachment(new File([new Uint8Array([255, 255])], "legacy.txt")),
  ).rejects.toThrow("UTF-8");
  await expect(readAttachment(new File(["not an image"], "fake.png"))).rejects.toThrow(
    "图片格式无效",
  );
  await expect(readAttachment(new File([" "], "blank.md"))).rejects.toThrow("没有可读取的文本");
});

test("enforces individual and batch bounds before reading or sending attachments", async () => {
  await expect(
    readAttachment(new File([new Uint8Array(200 * 1024 + 1)], "large.txt")),
  ).rejects.toThrow("200 KB");
  await expect(
    readAttachment(new File([new Uint8Array(1024 * 1024 + 1)], "large.png")),
  ).rejects.toThrow("1 MB");
  expect(() =>
    validateAttachmentBatch([{ size: 1 }], [{ size: 1 }, { size: 1 }, { size: 1 }]),
  ).toThrow("3 个");
  expect(() =>
    validateAttachmentBatch([{ size: 1024 * 1024 }], [{ size: 1024 * 1024 + 1 }]),
  ).toThrow("2 MB");
});

test("serializes documents as context and images as multimodal parts, including attachment-only messages", () => {
  const document: Attachment = {
    id: "a",
    name: "plan.md",
    size: 8,
    kind: "text",
    mime: "text/plain",
    data: "计划内容",
  };
  const image: Attachment = {
    id: "b",
    name: "photo.png",
    size: 12,
    kind: "image",
    mime: "image/png",
    data: "data:image/png;base64,iVBORw0KGgo=",
  };
  const message: Message = {
    id: "m",
    role: "user",
    content: "总结",
    createdAt: 1,
    attachments: [document, image],
  };
  expect(messageContent(message)).toEqual([
    { type: "text", text: '总结\n\n附件 "plan.md"：\n计划内容' },
    { type: "image_url", image_url: { url: image.data } },
  ]);
  expect(messageContent({ ...message, content: "", attachments: [image] })).toEqual([
    { type: "image_url", image_url: { url: image.data } },
  ]);
  expect(messageContent({ ...message, attachments: undefined })).toBe("总结");
});

function completion(frames: unknown[]) {
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("keeps reasoning separate from the final answer and exposes a missing answer", async () => {
  let reasoning = "",
    answer = "";
  await readCompletionStream(
    completion([
      { choices: [{ delta: { reasoning_content: "分析" } }] },
      { choices: [{ delta: { content: "结论" } }] },
    ]),
    (text) => {
      answer += text;
    },
    (text) => {
      reasoning += text;
    },
  );
  expect(answer).toBe("结论");
  expect(reasoning).toBe("分析");
  await expect(
    readCompletionStream(
      completion([
        { choices: [{ delta: { reasoning_content: "思考" }, finish_reason: "length" }] },
      ]),
      () => {},
    ),
  ).rejects.toThrow("输出上限");
  await expect(readCompletionStream(completion([]), () => {})).rejects.toThrow("未返回正文");
  await expect(
    readCompletionStream(Response.json({ choices: [{ message: { content: "" } }] }), () => {}),
  ).rejects.toThrow("未返回正文");
});
