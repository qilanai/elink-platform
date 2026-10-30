import { test, expect, type Page } from "@playwright/test";

async function mockHost(page: Page, models = ["chat-model"], userId = 12) {
  await page.route("**/api/ext/apps/chat/tokens?*", (route) => route.fulfill({ json: {
    success: true, data: { items: [{ id: 7, name: "创作专用", masked_key: "test********key7", group: "default", available: true }], has_more: false },
  } }));
  await page.route("**/api/ext/apps/chat/relay/v1/models", (route) => route.fulfill({ json: {
    data: models.map((id) => ({ id })), group: "default",
  } }));
  await page
    .context()
    .addCookies([{ name: "new_api_has_session", value: "1", url: "http://127.0.0.1:3102" }]);
  await page.route("**/api/user/auth/refresh", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          access_token: "test-session-only",
          access_expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: userId },
          session: { sid: `session-${userId}` },
        },
      },
    }),
  );
  await page.route("**/api/ext/apps/chat/bootstrap", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { user_id: userId, username: "测试用户", models },
      },
    }),
  );
  await page.route("**/api/ext/apps/chat/catalog", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          ...models.map((id) => ({
            id,
            endpoint_paths: ["/v1/chat/completions"],
          })),
          { id: "image-only", endpoint_paths: ["/v1/images/generations"] },
        ],
      },
    }),
  );
}

test("API key selection gates sending, filters models and survives reload without a secret", async ({ page }) => {
  await mockHost(page, ["chat-model", "forbidden-model"]);
  await page.route("**/api/ext/apps/chat/relay/v1/models", (route) => {
    expect(route.request().headers()["x-new-api-token-id"]).toBe("7");
    return route.fulfill({ json: { data: [{ id: "chat-model" }], group: "default" } });
  });
  let calls = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    calls++;
    expect(route.request().headers()["x-new-api-token-id"]).toBe("7");
    expect(route.request().headers().authorization).toBe("Bearer test-session-only");
    expect(route.request().headers()["x-new-api-group"]).toBeUndefined();
    expect(route.request().postDataJSON().model).toBe("chat-model");
    return route.fulfill({ json: { choices: [{ message: { content: "密钥调用成功" } }] } });
  });
  await page.goto("/apps/workspace/chat");
  await page.getByRole("textbox", { name: "输入消息" }).fill("你好");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "选择 API 密钥" }).press("ArrowDown");
  await page.getByText("创作专用 · test********key7", { exact: true }).last().click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "选择模型" }).press("ArrowDown");
  await expect(page.getByText("forbidden-model", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "选择模型" }).press("Escape");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("密钥调用成功", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByText("创作专用 · test********key7", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("test-session-only");
  await page.screenshot({ path: ".local/verification/chat-api-key.png", fullPage: true });
  await page.route("**/api/ext/apps/chat/tokens?*", (route) => route.fulfill({ json: { success: true, data: { items: [], has_more: false } } }));
  await page.getByRole("button", { name: "刷新模型" }).click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("密钥已撤销");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await expect(page.getByText("此 API 密钥已不可用，请重新选择。")).toBeVisible();
  expect(calls).toBe(1);
});

test("API key restrictions do not sign out the user or retry generation", async ({ page }) => {
  await mockHost(page);
  let calls = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    calls++;
    return route.fulfill({ status: 403, json: { error: { code: "CHAT_TOKEN_UNAVAILABLE", message: "密钥额度不足" } } });
  });
  await page.goto("/apps/workspace/chat");
  await page.getByRole("combobox", { name: "选择 API 密钥" }).press("ArrowDown");
  await page.getByText("创作专用 · test********key7", { exact: true }).last().click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("测试");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("密钥额度不足", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入消息" })).toBeEnabled();
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".local/verification/chat-api-key-mobile.png", fullPage: true });
});

async function chooseChatKey(page: Page) {
  await page.getByRole("combobox", { name: "选择 API 密钥" }).press("ArrowDown");
  await page.getByText("创作专用 · test********key7", { exact: true }).last().click();
}

test("send, regenerate, persist, isolate accounts, and render safe Markdown", async ({ page }) => {
  await mockHost(page);
  const requests: unknown[] = [];
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-session-only");
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"这是 **测试回复**。\\n\\n<script>window.injected=true</script>"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(page.getByText("今天想聊点什么？")).toBeVisible();
  await page.getByRole("textbox", { name: "输入消息" }).fill("你好，帮我整理一个计划");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("测试回复", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  expect(requests[0]).toEqual({
    model: "chat-model",
    stream: true,
    messages: [{ role: "user", content: "你好，帮我整理一个计划" }],
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://untrusted.example",
        source: window,
        data: {
          type: "new-api:ext-chat:session",
          accessToken: "forged-token",
          expiresAt: Date.now() / 1000 + 3600,
        },
      }),
    ),
  );
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await page.reload();
  await expect(page.getByText("测试回复", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-session-only",
  );
  expect(
    await page.evaluate(() => (window as unknown as { injected?: boolean }).injected),
  ).toBeUndefined();
  await page.screenshot({
    path: ".local/verification/lobehub-desktop.png",
    fullPage: true,
  });
  await mockHost(page, ["chat-model"], 13);
  await page.reload();
  await expect(page.getByText("今天想聊点什么？")).toBeVisible();
  await expect(page.getByText("测试回复", { exact: true })).toHaveCount(0);
});

test("empty model catalog disables generation, mobile sidebar remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHost(page, []);
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(
    page.getByText("当前账号没有支持文本对话的模型，请在主站配置后刷新。"),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "输入消息" }).fill("不应发送");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(page.locator("#chat-history-panel")).toBeVisible();
  await page.locator("#chat-history-panel").getByRole("button", { name: "新建对话" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: ".local/verification/lobehub-mobile.png",
    fullPage: true,
  });
});

test("upstream auth failure preserves conversation and never retries the paid request", async ({
  page,
}) => {
  await mockHost(page);
  let count = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    count++;
    return route.fulfill({
      status: 401,
      json: { error: { message: "expired" } },
    });
  });
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await page.getByRole("textbox", { name: "输入消息" }).fill("private message");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("expired", { exact: true })).toBeVisible();
  await expect(page.getByText("private message", { exact: true }).last()).toBeVisible();
  expect(count).toBe(1);
});

test("stopping generation aborts the request and permits a new conversation", async ({ page }) => {
  await mockHost(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", async (route) => {
    await pending;
    await route.abort().catch(() => undefined);
  });
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await page.getByRole("textbox", { name: "输入消息" }).fill("wait");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "停止生成" }).click();
  release();
  await page.getByRole("button", { name: "打开会话列表" }).click();
  await expect(page.locator("#chat-history-panel").getByRole("button", { name: "新建对话" })).toBeEnabled();
  await page.locator("#chat-history-panel").getByRole("button", { name: "新建对话" }).click();
  await expect(page.getByText("今天想聊点什么？")).toBeVisible();
});

test("host sign-out clears the visible workspace on reload", async ({ page }) => {
  await mockHost(page);
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(page.getByRole("textbox", { name: "输入消息" })).toBeEnabled();
  await page.route("**/api/user/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { success: false } }),
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "new-api:auth-session:event",
        newValue: JSON.stringify({
          kind: "signed_out",
          sid: "session-12",
          timestamp: Date.now(),
        }),
      }),
    ),
  );
  await expect(page.getByText("登录已过期，请返回主站重新登录。")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveCount(0);
});

test("marketplace models refresh within the selected key permissions", async ({
  page,
}) => {
  await mockHost(page, []);
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(
    page.getByText("当前账号没有支持文本对话的模型，请在主站配置后刷新。"),
  ).toBeVisible();
  await page.route("**/api/ext/apps/chat/catalog", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: "default-chat",
            groups: ["default"],
            endpoint_paths: ["/v1/chat/completions"],
          },
          {
            id: "vip-chat",
            groups: ["vip"],
            endpoint_paths: ["/v1/chat/completions"],
          },
          {
            id: "second-chat",
            groups: ["vip"],
            endpoint_paths: ["/v1/chat/completions"],
          },
          {
            id: "image-only",
            groups: ["vip"],
            endpoint_paths: ["/v1/images/generations"],
          },
        ],
      },
    }),
  );
  await page.route("**/api/ext/apps/chat/relay/v1/models", (route) => route.fulfill({ json: { data: [{ id: "vip-chat" }, { id: "second-chat" }], group: "vip" } }));
  await page.getByRole("button", { name: "刷新模型" }).click();
  await expect(page.getByRole("combobox", { name: "选择模型" })).toBeEnabled();
  await page.getByRole("combobox", { name: "选择模型" }).press("ArrowDown");
  await expect(page.getByText("image-only", { exact: true })).toHaveCount(0);
  await page.getByText("second-chat", { exact: true }).last().click();
  let calls = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    calls++;
    expect(route.request().headers()["x-new-api-token-id"]).toBe("7");
    expect(route.request().postDataJSON().model).toBe("second-chat");
    return route.fulfill({
      json: { choices: [{ message: { content: "模型选择成功" } }] },
    });
  });
  await page.getByRole("textbox", { name: "输入消息" }).fill("测试模型选择");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("模型选择成功", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "消息编辑器" }).getByText("second-chat", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("密钥分组：vip", { exact: true })).toBeVisible();
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    calls++;
    return route.fulfill({ status: 403, json: { error: { code: "CHAT_GROUP_FORBIDDEN" } } });
  });
  await page.getByRole("textbox", { name: "输入消息" }).fill("分组撤权");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("当前 API 密钥无权执行此请求，请检查密钥权限。")).toBeVisible();
  await expect(page.getByText("模型选择成功", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  await page.route("**/api/ext/apps/chat/catalog", (route) =>
    route.fulfill({ json: { success: true, data: [] } }),
  );
  await page.getByRole("button", { name: "刷新模型" }).click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("模型撤销后不应发送");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  expect(calls).toBe(2);
});

test("standalone home routes a real draft and model selection into chat", async ({ page }) => {
  await mockHost(page, ["chat-model", "other-model"]);
  await page.goto("/apps/workspace/");
  await expect(page.getByRole("heading", { name: /测试用户/ })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("combobox", { name: "首页选择模型" }).press("ArrowDown");
  await page.getByText("other-model", { exact: true }).last().click();
  await page.getByRole("textbox", { name: "描述你的想法" }).fill("设计一个作品集");
  await page.getByRole("button", { name: "开始对话", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/workspace\/chat$/);
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue("设计一个作品集");
  await chooseChatKey(page);
  await expect(page.getByText("other-model", { exact: true })).toBeVisible();
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    expect(route.request().postDataJSON().model).toBe("other-model");
    return route.fulfill({ json: { choices: [{ message: { content: "作品集方案" } }] } });
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("作品集方案", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "工作台导航" })
    .getByRole("link", { name: "首页", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /设计一个作品集/ })).toBeVisible();
  await page.getByRole("button", { name: "搜索应用与对话" }).click();
  await page.getByRole("textbox", { name: "搜索应用与对话" }).fill("作品集");
  await page.getByRole("dialog").getByRole("button", { name: "设计一个作品集" }).click();
  await expect(page.getByText("作品集方案", { exact: true })).toBeVisible();
});

test("planned modules remain honest, deep links and mobile navigation work", async ({ page }) => {
  await mockHost(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/apps/workspace/sites");
  await expect(page.getByRole("heading", { name: "网站创作", exact: true })).toBeVisible();
  await expect(page.getByText("建站功能尚未接入。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /发布|生成/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "网站创作", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开工作台导航" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "描述你的想法" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".local/verification/workspace-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "使用深色外观" }).click();
  await expect(page.locator(".chat-app")).toHaveClass(/dark/);
});

test("attaches real text and image payloads, removes drafts, retries and restores attachments", async ({
  page,
}) => {
  await mockHost(page);
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传文件" }).click();
  await (
    await chooser
  ).setFiles({
    name: "plan.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("目标：整理产品计划"),
  });
  await expect(page.getByRole("button", { name: "移除 plan.md" })).toBeVisible();
  await page.getByRole("button", { name: "移除 plan.md" }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await page.getByLabel("选择附件").setInputFiles([
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("目标：整理产品计划") },
    { name: "sample.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
  ]);
  await expect(page.getByRole("img", { name: "sample.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  const requests: unknown[] = [];
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: "已阅读附件" } }] } });
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已阅读附件", { exact: true })).toBeVisible();
  expect(requests[0]).toEqual({
    model: "chat-model",
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: '\n附件 "plan.md"：\n目标：整理产品计划' },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
        ],
      },
    ],
  });
  await expect(page.getByRole("button", { name: "移除 plan.md" })).toHaveCount(0);
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  await page.reload();
  await expect(page.getByRole("img", { name: "sample.png" })).toBeVisible();
  await expect(page.getByText("plan.md", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("已阅读附件", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/verification/chat-attachments-desktop.png",
    fullPage: true,
  });
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "上传文件" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sendBox = await page.getByRole("button", { name: "发送", exact: true }).boundingBox();
  expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".local/verification/chat-attachments-mobile.png",
    fullPage: true,
  });
});

test("unsupported and oversized attachments are rejected without a relay request", async ({
  page,
}) => {
  await mockHost(page);
  let requests = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    requests++;
    return route.abort();
  });
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(page.getByRole("button", { name: "上传文件" })).toBeEnabled();
  await page
    .getByLabel("选择附件")
    .setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
  await expect(page.getByRole("alert")).toContainText("暂不支持此格式");
  await page.getByLabel("选择附件").setInputFiles({
    name: "large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(200 * 1024 + 1, "a"),
  });
  await expect(page.getByRole("alert")).toContainText("200 KB");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  expect(requests).toBe(0);
});

test("empty answers show an actionable error and keep reasoning separate", async ({ page }) => {
  await mockHost(page);
  let calls = 0;
  await page.route("**/api/ext/apps/chat/relay/v1/chat/completions", (route) => {
    calls++;
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"reasoning_content":"先分析问题"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await page.getByRole("textbox", { name: "输入消息" }).fill("解释这个问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("输出上限");
  await page.getByText("思考过程", { exact: true }).click();
  await expect(page.getByText("先分析问题", { exact: true })).toBeVisible();
  await expect(page.getByText("（无文本回复）", { exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});

test("drop and paste add attachments locally and new empty conversation preserves the draft", async ({
  page,
}) => {
  await mockHost(page);
  await page.goto("/apps/workspace/chat");
  await chooseChatKey(page);
  await expect(page.getByRole("button", { name: "上传文件" })).toBeEnabled();
  const drop = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["拖入的资料"], "notes.txt", { type: "text/plain" }));
    return transfer;
  });
  await page
    .getByRole("region", { name: "消息编辑器" })
    .dispatchEvent("drop", { dataTransfer: drop });
  await expect(page.getByRole("button", { name: "移除 notes.txt" })).toBeVisible();
  const paste = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    return transfer;
  });
  await page.getByRole("textbox", { name: "输入消息" }).evaluate((element, clipboardData) => {
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }, paste);
  await expect(page.getByRole("img", { name: "pasted.png" })).toBeVisible();
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除 notes.txt" })).toBeVisible();
  await expect(page.getByRole("img", { name: "pasted.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("elink-lobehub:v1:12") || "[]").length)).toBe(1);
  await drop.dispose();
  await paste.dispose();
});
