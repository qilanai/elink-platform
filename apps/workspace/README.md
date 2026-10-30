# Elink Workspace

基于 LobeHub / LobeChat **v0.162.25（MIT）** 的浏览器聊天子集，由 Elink 自行维护。来源、精确提交与文件对应关系见 `NOTICE`；保留 `LICENSE` 和界面来源链接。不是完整的 LobeHub 2.x，也不自动同步上游。

## 运行

在 elink-platform 根目录：

```sh
bun install --frozen-lockfile
bun run dev:app
bun run typecheck:app
bun run test:app
bun run build:app
bun run test:app:e2e
```

主站 new-api 配置 `EXT_CHAT_UPSTREAM_URL=http://host.docker.internal:3102`（本机进程用 `http://127.0.0.1:3102`）。重启后端与主站前端开发服务，从 `/apps/workspace` 打开；全屏文档为 `/apps/workspace/`。本地编排 override 已保留 3102 端口配置。

独立调试可打开 `http://127.0.0.1:3102/apps/workspace/`，Vite 默认将 `/api` 转发到 `127.0.0.1:3000`，可用 `NEW_API_DEV_URL` 覆盖。正常使用从主站进入以复用登录状态。

构建产物在 `dist/`，部署到静态服务时须保留 `/apps/workspace/` 路径。`Dockerfile` 提供 nginx 静态镜像；从平台根目录执行 `docker build -f apps/workspace/Dockerfile -t elink-chat .`，例如以 `127.0.0.1:3102:8080` 发布端口。生产发布单独进行。

架构与后续任务、资源、图像、视频、建站的接入边界见 [架构设计](../../docs/architecture/creative-workspace.md)。

## 已接入

- 独立首页、全局侧栏、模块状态页、应用/本机对话搜索、真实最近对话与首页草稿传入聊天。

- 新建、切换、重命名、删除与导出对话；按主站用户 ID 区分本地历史。
- 流式文本聊天、Markdown/代码块/表格、复制、停止生成和手动重新生成；推理内容折叠展示，空正文及输出上限明确提示。
- 附件选择、拖放与粘贴图片；支持 PNG/JPEG/WebP/GIF（每个 ≤1 MB）以及 UTF-8 文本、Markdown、CSV、JSON 与常见代码文件（每个 ≤200 KB），每条最多 3 个且合计 ≤2 MB。发送前可预览、移除；点击发送后文本作为上下文、图片作为 image_url 消息交给既有主站 Relay。图片需使用支持视觉输入的模型，主站目录当前只提供聊天端点能力，不能据此保证所有模型均支持图片。
- 聊天先选择主站已创建的 API 密钥，再选择其授权的聊天模型；分组由密钥决定。空目录、未选择或失效密钥禁用发送，选择的 ID 随对话保存。
- `/chat/tokens` 仅返回当前用户的名称、脱敏标识和可用状态；请求通过 `X-New-API-Token-ID` 提交 ID。后端先校验浏览器会话与密钥归属，再复用 TokenAuth、模型权限和计费链路，扣减所选密钥额度并记录其名称。完整密钥不下发浏览器，不接受前端覆写分组或其他凭据传输方式。
- 每段对话独立的系统提示词、深浅主题及手机侧栏。
- 既有主站登录会话、模型授权、限流与结算链；无独立 API Key、供应商或价格配置。

历史只在此浏览器保存，不提供跨设备同步；同源脚本和有设备访问权的人能读取浏览器存储，用户隔离不是浏览器本地存储的安全边界。附件随本机对话保存、导出和重试，不上传到独立资源库；存储容量不足会提示导出备份。暂不解析 PDF/Word，不提供知识库、工具调用、联网、语音或图片生成。远程 Markdown 图片不自动加载，避免模型生成的图片 URL 发起跟踪请求。

访问令牌仅存内存，通过同源且校验窗口来源的消息通道或 HttpOnly 刷新 Cookie 获取。退出或切换会话触发页面重载，后端仍逐请求验证会话和权限。密钥或上游的 401/403 保留历史并显示错误，不误判为主站退出；主站会话刷新失败仍要求重新登录。生成请求不会自动重试，避免结果不明时重复扣费。

认证接入参考 OWASP [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) 、[Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) 和 [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。本次关注令牌不持久化、同源消息校验、退出失效、服务端权限和账号隔离，参考 ASVS 5.0.0 的会话与服务端授权要求，未宣称完成全部 ASVS 认证。

旧 NextChat 工作目录归档至平台忽略目录 `.local/retired-nextchat/`，未转换或清除其浏览器历史记录。运行脚本和主站入口已移除旧引用。

## 本次验证

2026-10-26 密钥选择：`go test ./ext/router ./ext/controller/apps`、对应 `go vet`、前端类型检查/构建，以及 `playwright test --grep 'API key'` 通过。覆盖归属、匿名/PAT 拒绝、失效/删除/额度/IP 限制、模型权限、备用凭据覆盖拦截、密钥和用户同步扣费及日志归属；桌面/移动布局、选择持久化、撤销后禁发和错误不自动重试。模拟上游，无真实模型消费。采用上述 OWASP 认证、会话与服务端授权原则，不改数据库 schema 或主站 TokenAuth 的既有规则。

本轮最终结果：17 项单测、14 项浏览器用例（失败用例修正旧断言后分批复验）、扩展 Go 测试与 vet、生产构建通过。浏览器旧抽屉/分组选项断言已适配页面内侧栏与密钥选择；空白新建保留附件草稿。线上发布 `20261026-chat-key`，Safari 真实账号已读取脱敏密钥列表并选择模型。实际生成仍观察到 `OpenAI-Sub` 上游返回 503，与密钥选择独立；没有宣称上游恢复。

以下为早期版本验证记录：

- `bun install --frozen-lockfile`、Chat 类型检查与生产构建通过。
- 12 项浏览器回归覆盖独立首页草稿、模块导航、深链刷新、附件发送与移动端，11 项传输/历史/附件单测；浏览器用模拟主站和模型响应验证发送、重新生成、安全 Markdown、用户隔离、停止、失效登录、退出与移动端布局。
- new-api `go test ./ext/router`、扩展包 vet/build、前端 typecheck/build、改动文件 lint 和应用入口 4 项回归通过。
- 模型广场对接回归：默认分组与其他可用分组、隐藏私有/禁用模型、分组撤权拒绝、实际转发所选分组并扣减主站用户额度（模拟上游），浏览器刷新/选择/保存及下架禁用发送。
- 未请求真实付费模型；未进行生产部署。本地后端已重建并通过健康检查；实际可选模型以当前账号与主站渠道配置为准。
- 构建仍有大 chunk 提示（LobeHub UI 的 Markdown/语法库依赖），后续可进一步裁剪。
