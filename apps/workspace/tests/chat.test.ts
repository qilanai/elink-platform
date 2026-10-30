import { describe, expect, test } from "bun:test";
import { readCompletionStream } from "../src/lib/api";
import { historyKey, loadHistory, newConversation, saveHistory } from "../src/lib/history";

function stream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("completion transport", () => {
  test("joins split SSE frames and CRLF without dropping Chinese text", async () => {
    let text = "";
    await readCompletionStream(
      stream([
        ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"你"}}]}\r',
        '\n\r\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      (value) => {
        text += value;
      },
    );
    expect(text).toBe("你好");
  });
  test("reports truncated streams and preserves text received before failure", async () => {
    let text = "";
    await expect(
      readCompletionStream(
        stream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
        (value) => {
          text += value;
        },
      ),
    ).rejects.toThrow("连接提前中断");
    expect(text).toBe("partial");
  });
  test("surfaces upstream errors delivered inside a successful HTTP stream", async () => {
    await expect(
      readCompletionStream(stream(['data: {"error":{"message":"quota exhausted"}}\n\n']), () => {}),
    ).rejects.toThrow("quota exhausted");
  });
  test("accepts a non-streaming completion without silently dropping its content", async () => {
    let text = "";
    await readCompletionStream(
      Response.json({ choices: [{ message: { content: "answer" } }] }),
      (value) => {
        text += value;
      },
    );
    expect(text).toBe("answer");
  });
});

describe("account-scoped local history", () => {
  test("restores only the verified user history and never writes credentials", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const chat = newConversation("allowed-model");
    chat.messages.push({ id: "m1", role: "user", content: "Private question", createdAt: 1 });
    saveHistory(storage, 12, [chat]);
    expect(loadHistory(storage, 12)).toEqual([chat]);
    expect(loadHistory(storage, 13)).toEqual([]);
    expect(values.get(historyKey(12))).not.toContain("access_token");
  });
  test("rejects corrupt history instead of replacing it with an empty conversation", () => {
    expect(() => loadHistory({ getItem: () => "{broken" }, 12)).toThrow();
    expect(() => loadHistory({ getItem: () => '[{"id":"a"}]' }, 12)).toThrow(
      "本地历史记录格式异常",
    );
  });
  test("reports storage failures so the UI can warn instead of claiming a save", () => {
    expect(() =>
      saveHistory(
        {
          setItem: () => {
            throw new Error("QuotaExceeded");
          },
        },
        12,
        [],
      ),
    ).toThrow("QuotaExceeded");
  });
});
