import {
  Alert,
  App as AntApp,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tooltip,
} from "antd";
import {
  Menu,
  PanelLeftClose,
  MessageSquare,
  Search,
  MessageSquarePlus,
  Settings2,
  Trash2,
  Download,
  Pencil,
  Paperclip,
  ArrowUp,
  Square,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ConversationView from "../Conversation";
import SkeletonList from "../Conversation/SkeletonList";
import { bootstrap, complete, fetchChatTokens, fetchTokenModels, SessionExpiredError } from "../../lib/api";
import { loadHistory, newConversation, saveHistory } from "../../lib/history";
import { subscribeNewAPISession } from "../../lib/session";
import AttachmentList from "./AttachmentList";
import { ATTACHMENT_ACCEPT, readAttachment, validateAttachmentBatch } from "../../lib/attachments";
import type { Attachment, Bootstrap, ChatToken, Conversation, Message } from "../../types";

export interface ChatDraft {
  text: string;
  model: string;
  group: string;
}

export default function ChatApp({
  initialAccount,
  draft,
  conversationId,
  onSessionExpired,
  onDraftConsumed,
}: {
  initialAccount: Bootstrap;
  draft?: ChatDraft;
  conversationId?: string;
  onSessionExpired: () => void;
  onDraftConsumed?: () => void;
}) {
  const { message } = AntApp.useApp();
  const [account, setAccount] = useState<Bootstrap>();
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState(draft?.text || "");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const readingRef = useRef(false);
  const fileReadVersion = useRef(0);
  const [generatingId, setGeneratingId] = useState<string>();
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [tokens, setTokens] = useState<ChatToken[]>([]);
  const [tokenCatalog, setTokenCatalog] = useState<{ tokenId: number; models: string[]; group: string }>();
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [loadingTokenModels, setLoadingTokenModels] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const historyToggle = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController>();
  const active = sessions.find((s) => s.id === activeId);
  const selectedToken = tokens.find((token) => token.id === active?.tokenId);
  const selectedGroup = tokenCatalog?.tokenId === active?.tokenId ? tokenCatalog?.group || "" : "";
  const availableModels =
    selectedToken?.available && tokenCatalog?.tokenId === active?.tokenId
      ? account?.catalog.filter((m) => tokenCatalog?.models.includes(m.id)).map((m) => m.id) || []
      : [];
  const modelAvailable = !!active && availableModels.includes(active.model);

  useEffect(() => {
    let disposed = false;
    setLoadingTokens(true);
    void fetchChatTokens().then((items) => {
      if (!disposed) { setTokens(items); setTokenError(""); }
    }).catch((cause) => {
      if (!disposed) setTokenError(cause instanceof Error ? cause.message : "无法读取 API 密钥");
    }).finally(() => { if (!disposed) setLoadingTokens(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    setTokenCatalog(undefined);
    setTokenError("");
    if (!selectedToken?.available) { setLoadingTokenModels(false); return; }
    const tokenId = selectedToken.id;
    setLoadingTokenModels(true);
    void fetchTokenModels(tokenId).then((catalog) => {
      if (disposed) return;
      setTokenCatalog({ ...catalog, tokenId });
      const models = catalog.models.filter((id) => account?.catalog.some((m) => m.id === id));
      setSessions((all) => all.map((s) => s.id === activeId && s.tokenId === tokenId
        ? { ...s, group: catalog.group, model: models.includes(s.model) ? s.model : models[0] || "" } : s));
    }).catch((cause) => {
      if (!disposed) setTokenError(cause instanceof Error ? cause.message : "无法读取模型权限");
    }).finally(() => { if (!disposed) setLoadingTokenModels(false); });
    return () => { disposed = true; };
  }, [activeId, active?.tokenId, tokens, account]);

  const refreshModels = async () => {
    if (!account || refreshingModels) return;
    setRefreshingModels(true);
    try {
      const data = await bootstrap();
      const keys = await fetchChatTokens();
      if (data.user_id !== account.user_id) throw new SessionExpiredError();
      setAccount(data);
      setTokens(keys);
      setError("");
      setSessions((all) =>
        all.map((s) => (!s.model ? { ...s, model: data.models[0] || "", group: data.group } : s)),
      );
      void message.success("模型列表已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型刷新失败");
      if (cause instanceof SessionExpiredError) {
        setAccount(undefined);
        setSessions([]);
        setHistoryReady(false);
        onSessionExpired();
      }
    } finally {
      setRefreshingModels(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    const unsubscribe = subscribeNewAPISession();
    void Promise.resolve(initialAccount)
      .then((data) => {
        if (disposed) return;
        setAccount(data);
        try {
          const saved = loadHistory(localStorage, data.user_id);
          const fresh = draft ? newConversation(draft.model, draft.group) : undefined;
          const restored = fresh
            ? [fresh, ...saved]
            : saved.length
              ? saved
              : [newConversation(data.models[0] || "", data.group)];
          setSessions(restored);
          setActiveId(restored.find((s) => s.id === conversationId)?.id || restored[0].id);
          setHistoryReady(true);
          onDraftConsumed?.();
        } catch (cause) {
          setStorageError(cause instanceof Error ? cause.message : "无法读取本地记录");
        }
      })
      .catch((cause) => {
        if (!disposed) setError(cause.message);
      })
      .finally(() => {
        if (!disposed) setInitializing(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
      controller.current?.abort();
      fileReadVersion.current++;
    };
  }, []);

  useEffect(() => {
    if (!account || !historyReady) return;
    try {
      saveHistory(localStorage, account.user_id, sessions);
      setStorageError("");
    } catch {
      setStorageError("无法保存到此浏览器（空间不足或存储被禁用）。请导出对话备份。");
    }
  }, [account, historyReady, sessions]);

  const updateActive = (patch: Partial<Conversation>) => {
    setSessions((all) => all.map((s) => (s.id === activeId ? { ...s, ...patch } : s)));
  };

  const addAttachments = async (files: File[]) => {
    if (!files.length || readingRef.current || controller.current || !active || !account) return;
    readingRef.current = true;
    setReadingFiles(true);
    setAttachmentError("");
    const version = ++fileReadVersion.current;
    try {
      validateAttachmentBatch(attachments, files);
      const loaded = await Promise.all(files.map(readAttachment));
      if (version === fileReadVersion.current) setAttachments((current) => [...current, ...loaded]);
    } catch (cause) {
      if (version === fileReadVersion.current)
        setAttachmentError(cause instanceof Error ? cause.message : "读取附件失败");
    } finally {
      readingRef.current = false;
      if (version === fileReadVersion.current) setReadingFiles(false);
    }
  };

  const clearDraft = () => {
    fileReadVersion.current++;
    setInput("");
    setAttachments([]);
    setAttachmentError("");
    setReadingFiles(false);
  };

  const run = async (retry = false) => {
    if (!active || !account || controller.current || readingRef.current || !modelAvailable || loadingTokenModels || refreshingModels || !selectedToken?.available) return;
    const text = input.trim();
    if (!retry && !text && !attachments.length) return;
    const conversationId = active.id;
    const history: Message[] = retry
      ? active.messages.slice(0, -1)
      : [
          ...active.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            attachments: attachments.length ? attachments : undefined,
            createdAt: Date.now(),
          },
        ];
    const reply: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model: active.model,
      createdAt: Date.now(),
    };
    const abort = new AbortController();
    controller.current = abort;
    setGeneratingId(reply.id);
    setError("");
    if (!retry) clearDraft();
    setSessions((all) =>
      all.map((s) =>
        s.id === conversationId
          ? {
              ...s,
              messages: [...history, reply],
              updatedAt: Date.now(),
              title: s.messages.length
                ? s.title
                : (text || attachments[0]?.name || "新对话").slice(0, 36),
            }
          : s,
      ),
    );
    const patchReply = (patch: Partial<Message>) =>
      setSessions((all) =>
        all.map((s) =>
          s.id === conversationId
            ? {
                ...s,
                messages: s.messages.map((m) => (m.id === reply.id ? { ...m, ...patch } : m)),
              }
            : s,
        ),
      );
    let content = "";
    let reasoning = "";
    try {
      await complete(
        active.model,
        history,
        active.systemRole,
        abort.signal,
        (delta) => {
          content += delta;
          patchReply({ content });
        },
        selectedGroup,
        (delta) => {
          reasoning += delta;
          patchReply({ reasoning });
        },
        selectedToken.id,
      );
    } catch (cause) {
      if (abort.signal.aborted) {
        patchReply({ error: "已停止生成" });
      } else {
        const reason = cause instanceof Error ? cause.message : "生成失败";
        patchReply({ error: reason });
        if (cause instanceof SessionExpiredError) {
          setAccount(undefined);
          setSessions([]);
          setHistoryReady(false);
          onSessionExpired();
          setError(reason);
        }
      }
    } finally {
      if (controller.current === abort) {
        controller.current = undefined;
        setGeneratingId(undefined);
      }
    }
  };

  const addConversation = () => {
    if (!account || !historyReady || generatingId) return;
    setHistorySearch("");
    // Keep the current blank conversation, including any unsent text or attachments.
    if (active && !active.messages.length) return;
    const empty = sessions.find((session) => !session.messages.length && session.title === "新对话" && !session.systemRole);
    if (empty) {
      setActiveId(empty.id);
      clearDraft();
      return;
    }
    const fresh = newConversation(account.models[0] || "", account.group);
    setSessions((all) => [fresh, ...all]);
    setActiveId(fresh.id);
    clearDraft();
  };
  const exportHistory = () => {
    const blob = new Blob([JSON.stringify(sessions, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "elink-chat-history.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const rename = () => {
    if (!active) return;
    let title = active.title;
    Modal.confirm({
      title: "重命名对话",
      okText: "保存",
      cancelText: "取消",
      content: (
        <Input
          aria-label="对话名称"
          defaultValue={title}
          maxLength={80}
          onChange={(e) => {
            title = e.target.value;
          }}
        />
      ),
      onOk: () => {
        if (title.trim()) updateActive({ title: title.trim() });
      },
    });
  };
  const remove = () => {
    if (!active || !account || generatingId) return;
    Modal.confirm({
      title: "删除此对话？",
      content: "这将删除此浏览器中保存的这段对话。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        const remaining = sessions.filter((s) => s.id !== activeId);
        if (!remaining.length)
          remaining.push(newConversation(account.models[0] || "", account.group));
        setSessions(remaining);
        setActiveId(remaining[0].id);
        clearDraft();
      },
    });
  };

  const sidebar = (
    <>
      <div className="chat-history-heading">
        <strong id="chat-history-heading">对话</strong>
        <Button type="text" aria-label="收起对话列表" icon={<PanelLeftClose size={17} />}
          onClick={() => { setSidebarOpen(false); historyToggle.current?.focus(); }} />
      </div>
      <Button
        type="primary"
        block
        icon={<MessageSquarePlus size={16} />}
        onClick={addConversation}
        disabled={!historyReady || !!generatingId}
      >
        新建对话
      </Button>
      <Input
        className="chat-history-search"
        aria-label="搜索历史对话"
        placeholder="搜索对话"
        prefix={<Search size={15} />}
        allowClear
        value={historySearch}
        onChange={(event) => setHistorySearch(event.target.value)}
      />
      <div className="sidebar-label">
        历史对话 <span>{sessions.length}</span>
      </div>
      <nav className="session-list" aria-label="对话记录">
        {sessions.filter((s) => s.title.toLowerCase().includes(historySearch.trim().toLowerCase())).map((s) => (
          <Button
            key={s.id}
            type="text"
            className={s.id === activeId ? "session-item active" : "session-item"}
            block
            aria-current={s.id === activeId ? "page" : undefined}
            disabled={!!generatingId}
            onClick={() => {
              setActiveId(s.id);
              clearDraft();
            }}
          >
            <MessageSquare size={16} />
            <span className="session-title">{s.title}</span>
          </Button>
        ))}
        {!sessions.some((s) => s.title.toLowerCase().includes(historySearch.trim().toLowerCase())) && (
          <p className="chat-history-empty">没有找到相关对话</p>
        )}
      </nav>
      <div className="sidebar-footer">
        <small>对话记录保存在此浏览器</small>
        <Button
          block
          icon={<Download size={15} />}
          disabled={!sessions.length}
          onClick={exportHistory}
        >
          导出对话
        </Button>
      </div>
    </>
  );

  return (
    <div className={`workspace workspace-chat${sidebarOpen ? " history-open" : ""}`}>
      {sidebarOpen && (
        <aside id="chat-history-panel" className="chat-history-panel" aria-labelledby="chat-history-heading">
          {sidebar}
        </aside>
      )}
      <main className="main">
        <header className="chat-header">
          <Button
            className="mobile-menu"
            ref={historyToggle}
            type="text"
            aria-label={sidebarOpen ? "收起会话列表" : "打开会话列表"}
            aria-expanded={sidebarOpen}
            aria-controls="chat-history-panel"
            icon={<Menu size={18} />}
            onClick={() => setSidebarOpen((open) => !open)}
          />
          <div className="header-title">
            <strong>{active?.title || "AI 对话"}</strong>
            <small>对话记录保存在此浏览器</small>
          </div>
          <Space size={4}>
            <Tooltip title="重命名">
              <Button
                type="text"
                aria-label="重命名对话"
                icon={<Pencil size={16} />}
                disabled={!active || !!generatingId}
                onClick={rename}
              />
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="text"
                aria-label="删除对话"
                icon={<Trash2 size={16} />}
                disabled={!active || !!generatingId}
                onClick={remove}
              />
            </Tooltip>
            <Tooltip title="助手设定">
              <Button
                type="text"
                aria-label="助手设定"
                icon={<Settings2 size={17} />}
                disabled={!active || !!generatingId}
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
            <Tooltip title="新建对话">
              <Button
                type="text"
                aria-label="新建对话"
                icon={<MessageSquarePlus size={18} />}
                onClick={addConversation}
                disabled={!historyReady || !!generatingId}
              />
            </Tooltip>
          </Space>
        </header>
        {storageError && <Alert type="warning" showIcon message={storageError} />}
        {error && <Alert type="error" showIcon message={error} />}
        {initializing ? (
          <div className="initializing">
            <Spin />
            <SkeletonList />
          </div>
        ) : (
          <>
            {active?.messages.length ? (
              <ConversationView
                key={activeId}
                id={activeId}
                messages={active.messages}
                generatingId={generatingId}
                onRetry={() => void run(true)}
                onCopy={(text) => {
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => message.success("已复制"))
                    .catch(() => message.error("复制失败，请手动选择文本复制"));
                }}
              />
            ) : (
              <div className="welcome">
                <div className="welcome-mark">✦</div>
                <h1>今天想聊点什么？</h1>
                <p>从一个问题开始，让想法更进一步。</p>
                <div className="suggestions">
                  {["帮我梳理一个想法", "解释一段代码", "润色我的文案"].map((text) => (
                    <Button key={text} disabled={!active} onClick={() => setInput(text)}>
                      {text}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <section
              className="composer"
              aria-label="消息编辑器"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (event.dataTransfer.files.length) {
                  event.preventDefault();
                  void addAttachments(Array.from(event.dataTransfer.files));
                }
              }}
              onPaste={(event) => {
                if (event.clipboardData?.files.length) {
                  event.preventDefault();
                  void addAttachments(Array.from(event.clipboardData.files));
                }
              }}
            >
              {account && !account.catalog.length && (
                <Alert type="info" message="当前账号没有支持文本对话的模型，请在主站配置后刷新。" />
              )}
              {!loadingTokens && !tokens.length && !tokenError && (
                <Alert type="info" message={<span>还没有 API 密钥，请先前往 <a href="/keys" target="_blank" rel="noopener noreferrer">API 密钥管理</a> 创建。</span>} />
              )}
              {tokenError && <Alert type="warning" message={tokenError} />}
              {active?.tokenId && !loadingTokens && !selectedToken?.available && <Alert type="warning" message="此 API 密钥已不可用，请重新选择。" />}
              {selectedToken?.available && !loadingTokenModels && tokenCatalog && !availableModels.length && (
                <Alert type="info" message="此 API 密钥没有可用聊天模型，请选择其他密钥或调整模型权限。" />
              )}
              {active?.model && selectedToken?.available && !loadingTokenModels && account?.catalog.length && !modelAvailable ? (
                <Alert type="warning" message="此对话的模型已不可用，请重新选择。" />
              ) : null}
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                aria-label="选择附件"
                hidden
                onChange={(event) => {
                  void addAttachments(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              {attachmentError && (
                <Alert
                  type="warning"
                  showIcon
                  message={attachmentError}
                  closable
                  onClose={() => setAttachmentError("")}
                />
              )}
              {!!attachments.length && (
                <AttachmentList
                  items={attachments}
                  onRemove={(id) => setAttachments((all) => all.filter((file) => file.id !== id))}
                />
              )}
              <Input.TextArea
                aria-label="输入消息"
                placeholder="询问任何问题，或添加文件一起讨论…"
                value={input}
                autoSize={{ minRows: 2, maxRows: 8 }}
                disabled={!active || !account}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void run();
                  }
                }}
              />
              <div className="composer-toolbar">
                <Tooltip title="添加图片或文本文件">
                  <Button
                    type="text"
                    aria-label="上传文件"
                    icon={<Paperclip size={18} />}
                    loading={readingFiles}
                    disabled={!active || !account || !!generatingId}
                    onClick={() => fileInput.current?.click()}
                  />
                </Tooltip>
                <Select
                  aria-label="选择 API 密钥"
                  placeholder="选择 API 密钥"
                  value={selectedToken?.id}
                  options={tokens.map((token) => ({
                    value: token.id,
                    label: `${token.name || "未命名密钥"} · ${token.masked_key}${token.available ? "" : "（不可用）"}`,
                    disabled: !token.available,
                  }))}
                  showSearch
                  optionFilterProp="label"
                  loading={loadingTokens}
                  disabled={!active || !!generatingId || refreshingModels || loadingTokens}
                  onChange={(tokenId) => updateActive({ tokenId })}
                  variant="borderless"
                  className="composer-token"
                />
                <Select
                  aria-label="选择模型"
                  placeholder={selectedToken ? "选择模型" : "请先选择 API 密钥"}
                  value={modelAvailable ? active?.model : undefined}
                  options={availableModels.map((id) => ({
                    value: id,
                    label: id,
                  }))}
                  showSearch
                  optionFilterProp="label"
                  disabled={!active || !!generatingId || !selectedToken?.available || loadingTokenModels || refreshingModels}
                  loading={loadingTokenModels}
                  onChange={(model) => updateActive({ model, group: selectedGroup })}
                  variant="borderless"
                  className="composer-model"
                />
                <Button
                  type="text"
                  icon={<RefreshCw size={15} />}
                  aria-label="刷新模型"
                  loading={refreshingModels}
                  disabled={!account || !!generatingId}
                  onClick={() => void refreshModels()}
                />
                <div className="composer-spacer" />
                {generatingId ? (
                  <Button
                    aria-label="停止生成"
                    shape="circle"
                    icon={<Square size={15} />}
                    onClick={() => controller.current?.abort()}
                  />
                ) : (
                  <Button
                    aria-label="发送"
                    type="primary"
                    shape="circle"
                    icon={<ArrowUp size={19} />}
                    disabled={
                      (!input.trim() && !attachments.length) ||
                      readingFiles ||
                      !active ||
                      loadingTokenModels || refreshingModels ||
                      !modelAvailable
                    }
                    onClick={() => void run()}
                  />
                )}
              </div>
              <div className="composer-key-hint">
                <span>{selectedGroup ? `密钥分组：${selectedGroup}` : "选择 API 密钥，按其权限与额度发送"}</span>
                <a href="/keys" target="_blank" rel="noopener noreferrer">管理密钥 ↗</a>
              </div>
              <div className="composer-hint">
                <span>
                  {attachments.length
                    ? "附件将在发送时提交给模型；图片需选择支持视觉的模型。"
                    : "支持图片（≤1 MB）、文本 / 代码（≤200 KB），最多 3 个。"}
                </span>
                <span>Enter 发送 · Shift + Enter 换行</span>
              </div>
            </section>
          </>
        )}
      </main>
      <Modal
        title="助手设定"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => setSettingsOpen(false)}
        okText="完成"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <label htmlFor="system-role">系统提示词</label>
        <p>为当前对话指定助手的角色、语气或要求。</p>
        <Input.TextArea
          id="system-role"
          value={active?.systemRole}
          autoSize={{ minRows: 5, maxRows: 12 }}
          onChange={(e) => updateActive({ systemRole: e.target.value })}
        />
      </Modal>
    </div>
  );
}
