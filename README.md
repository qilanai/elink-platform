# Elink Platform

独立创作工作台位于 `/apps/workspace/`：首页、统一导航、真实模型选择与聊天已接入；任务、资源、图像、视频和建站展示后续接入状态。使用 `bun run dev:app` 启动前端。架构、服务边界与迁移阶段见 [创作工作台架构](docs/architecture/creative-workspace.md)。

Elink 自维护的创作应用。new-api 的 `/apps` 用列表展示 Studio、建站等应用；Studio 在新浏览器标签页打开 `/apps/studio/`，完整加载本仓库的 Open AI Canvas 页面、画布、项目、素材和时间线。建站目前标记为“即将推出”，尚无可启动的实现。

Canvas 已作为普通源码导入，保留原始许可证、NOTICE 与署名，不再使用子模块或自动同步上游。出处记录在 `source-origins.json`。现有 `apps/console` 仅是开发诊断入口，正式入口由独立的 new-api 仓库提供。

## 运行边界

```text
new-api /apps 列表
  → 新标签页 /apps/studio/
  → 固定目标反向代理 → Studio web → Studio API / Worker
                                   ↓
                new-api 浏览器会话校验、用户模型目录、relay、结算
```

Studio 保留独立 React 根节点和路由，页面不嵌入 new-api 控制台布局。双方通过 HTTP 对接，不共享数据库，也不依赖绝对目录导入。

### 账号

- 使用 new-api 已登录浏览器的 HttpOnly 刷新 Cookie，刷新得到的短期访问令牌只在内存中用于建立 Studio 的 HttpOnly、SameSite=Strict Cookie，不进入 URL 或浏览器持久存储。
- Studio 每个业务请求调用主站校验身份；本地 `new-api-<id>` 用户记录只用于项目、素材和任务归属。主站管理员不会自动成为 Canvas 管理员，旧同名用户不会被合并。
- 主站退出、切换账号时重新加载 Studio；重新获得焦点时检查会话有效期，仅临近到期时刷新，避免标签切换消耗登录限流额度。资源缓存沿用 Canvas 的按用户隔离机制。
- 设置 `CANVAS_NEW_API_URL` 后，不注册旧注册、密码登录、OAuth、充值、兑换、账单和渠道管理接口。历史表仍保留，不清零、不折算旧余额。
- 普通任务把本次短期访问凭据加密保存；Agent 子任务只能从本用户的父任务恢复凭据。每次模型执行仍由 new-api 验证登录会话、用户状态和分组权限。会话过期或撤销后执行失败，不能无限续期。记忆压缩使用当前会话手动执行，不提供无会话的定时调用。

认证边界参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [ASVS](https://owasp.org/www-project-application-security-verification-standard/)。

### 模型与费用

模型只读取 new-api 当前用户组可用的模型广场元数据。不复制渠道密钥，不维护第二份供应商、模型价格或路由配置。界面中的 `new-api-text/image/video/audio` 是协议分组，不是新的供应商渠道。

| 主站端点 | Studio 用途 |
| --- | --- |
| OpenAI Chat / Responses | 文本节点、助手、Agent |
| Image Generation / Edits | 图片生成与编辑 |
| OpenAI Video | 视频生成与结果查询 |
| `/v1/audio/speech` | 语音生成 |
| `/v1/audio/transcriptions` | 时间线字幕转写 |

自定义模型名称不会被猜测为某种能力。语音模型需要在 new-api 模型元数据中配置对应的端点路径；时间线默认选择当前账号目录中首个转写模型，也接受明确的模型 ID。嵌入、重排和供应商私有工作流端点不映射为创作模型。具体供应商是否接受参考图、时长、分辨率等参数，取决于主站渠道的协议能力。

提交任务时重新读取模型目录，覆盖客户端的地址、密钥、渠道和协议信息；浏览器不能提交任意上游地址。Studio 模型请求进入主站 `/api/ext/apps/studio/relay/v1/*`，复用主站验证、限流、预扣、结算和失败处理。Studio 不生成积分账户或积分账单，不展示独立充值和模型报价。生成审批保留，显示主站结算提示，不伪造零费用。

凭据目前受主站访问令牌有效期约束；超过该期限的排队任务或长 Agent 运行需要重新提交。没有实现独立于登录会话的长时执行授权协议，也不承诺跨网关网络故障自动重放不会重复生成。不要在结果不明时自动重发付费请求。

## 本地启动

使用 Docker Compose、Python 3 和 Bun。Studio 保留目录内的依赖锁文件及工具链。

```bash
bun install --frozen-lockfile
bun run dev:init
bun run dev:up
```

再在相邻 new-api 仓库启动同源代理：

```bash
docker compose -f docker-compose.dev.yml \
  -f ../elink-platform/ops/dev/new-api.override.yaml up -d --build new-api
cd web
bun run dev
```

从 [应用中心](http://127.0.0.1:5173/apps) 进入。已有 Rsbuild 开发服务修改代理配置后需要重启。不要直接打开 3101 端口作为正式入口；该端口只用于本地 Studio 健康检查和网关转发。

| 配置 | 用途 |
| --- | --- |
| new-api `EXT_STUDIO_UPSTREAM_URL` | 固定 Studio web 目标，本地为 `http://host.docker.internal:3101` |
| Studio `CANVAS_NEW_API_URL` | new-api 内部源地址 |
| `VITE_NEW_API_HOSTED=true` | 构建时启用主站账号模式 |
| `VITE_STUDIO_BASE_PATH=/apps/studio/` | Studio 文档及资源前缀 |
| `VITE_CANVAS_BACKEND_URL=/apps/studio/api` | 同源业务 API |
| `CANVAS_PUBLIC_BASE_URL` | 可被模型供应商访问的主站公网源地址，用于短期签名素材链接 |
| `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` | 仅精确允许内部 new-api 主机；不开放所有私网 |

`.local/dev.env` 保存本地随机数据库和 Agent 凭据，不提交到 Git。开发编排使用独立的 PostgreSQL、Redis 和命名卷。服务更新保留已有数据，`dev:down` 不删除卷。

```bash
bun run dev:status
bun run dev:check
python3 scripts/workspace/dev.py logs
bun run dev:down
```

生产配置仍在既有部署仓库，本次只修改本地源码与编排。生产需同时部署 new-api 和 Studio 的对应版本，提供可访问的签名素材源地址，并保持 HTTPS 和明确的 CORS 源。

## 验证

接入回归位于 `apps/studio/backend/internal/app/new_api_test.go` 和 `internal/handler/new_api_test.go`，覆盖真实身份映射、停用旧接口、跨用户拒绝、凭据加密、目录权限、撤销会话和不产生 Studio 积分账单。new-api 扩展测试覆盖主站鉴权和真实 relay 对模拟模型的结算；没有调用外部付费模型。

```bash
cd apps/studio/backend
GOWORK=off go test ./internal/app ./internal/handler ./internal/platform
GOWORK=off go vet ./internal/app ./internal/handler ./internal/platform
cd ../web
bun run typecheck
bun run build
bun test test/new-api-session.test.ts test/creation-inspirations.test.ts test/creation-generation-config.test.ts test/creation-submit-gate.test.ts
```

2026-10-15 本地验收：应用列表以新标签打开完整 Studio；沿用 new-api 账号；创建“Studio 接入验证”画布、改名、刷新后恢复并显示“已同步”。本地模型广场当前返回 0 个模型，因此模型选择器显示空状态；没有添加虚构模型或调用付费生成。接入后端专项测试、Go vet、前端类型检查、应用列表 3 项测试、Studio 相关 8 项测试及编排 3 项测试通过。

全量检查未全部通过：new-api 存量文件有格式、lint、版权头问题，完整前端套件出现其他模块的超时失败后停止；Studio 完整 app 套件首次因缺少本机 Agent 依赖出现失败并达到总超时。已安装锁定依赖并通过相关专项回归，未将专项通过表述为完整套件通过。

只有测试实际通过的范围才视为已验证。供应商私有协议、真实付费图像/视频生成、长时间异步任务以及生产发布需要对应环境验证；不能用模型目录成功代替生成验收。

## 来源与许可

Studio 基于 [ddcat-ai/open-ai-canvas](https://github.com/ddcat-ai/open-ai-canvas)，保留其 MIT LICENSE、NOTICE 和界面署名。模型服务使用 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 及现有自有 fork，保留其独立许可证与署名。new-api 继续使用自身的 upstream fork 流程。

## AI 对话

原 NextChat 已由 `apps/workspace` 中的 LobeHub Web 子集替代，主站 `/apps/chat` 和 `/apps/lobehub/` 跳转至独立 `/apps/workspace/chat`。使用 `bun run dev:app` 启动，`bun run build:app` 构建；详情与范围见 [Workspace README](apps/workspace/README.md)。导入 MIT 许可的 v0.162.25 浏览器组件，后续由本项目维护。
