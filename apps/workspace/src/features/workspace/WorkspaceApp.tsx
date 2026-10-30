import { lazy, Suspense, useEffect, useState } from "react";
import { Alert, Button, Drawer, Input, Modal, Spin } from "antd";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import { ArrowUpRight, ChevronsUpDown, Menu, Moon, Search, Sun, X } from "lucide-react";
import { bootstrap, SessionExpiredError, SessionRetryError } from "../../lib/api";
import { subscribeNewAPISession } from "../../lib/session";
import { loadHistory } from "../../lib/history";
import { defaultLogo, loadHostLogo } from "../../lib/brand";
import type { Bootstrap } from "../../types";
import type { ChatDraft } from "../chat/ChatWorkspace";
import { modules } from "./modules";
import HomePage from "./HomePage";
import ModulePage from "./ModulePage";
import ModuleLink from "./ModuleLink";

const ChatWorkspace = lazy(() => import("../chat/ChatWorkspace"));

function AppRedirect({ href }: { href: string }) {
  useEffect(() => { window.location.replace(href); }, [href]);
  return <div className="workspace-loading"><Spin /><a href={href}>打开创作应用</a></div>;
}

function ChatPage(props: { account: Bootstrap; onSessionExpired: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ChatDraft | undefined>(() => location.state?.draft);
  const conversationId = new URLSearchParams(location.search).get("conversation") || undefined;
  useEffect(() => {
    if (location.state?.draft)
      void navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);
  return (
    <ChatWorkspace
      key={conversationId || "current"}
      initialAccount={props.account}
      draft={draft}
      onDraftConsumed={() => setDraft(undefined)}
      conversationId={conversationId}
      onSessionExpired={props.onSessionExpired}
    />
  );
}

export default function WorkspaceApp({ dark, onTheme }: { dark: boolean; onTheme: () => void }) {
  const [account, setAccount] = useState<Bootstrap>();
  const [logo, setLogo] = useState(defaultLogo);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchHistory, setSearchHistory] = useState<{ id: string; title: string }[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const current = modules.find((m) => m.path === location.pathname);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    void loadHostLogo(controller.signal).then((url) => {
      if (!controller.signal.aborted) setLogo(url);
    }).catch(() => undefined);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = logo;
  }, [logo]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = subscribeNewAPISession();
    setLoading(true);
    setError("");
    setRetryAt(0);
    setNeedsLogin(false);
    void bootstrap()
      .then((data) => {
        if (!disposed) setAccount(data);
      })
      .catch((cause: Error) => {
        if (!disposed) {
          setError(cause.message);
          setNeedsLogin(cause instanceof SessionExpiredError);
          if (cause instanceof SessionRetryError) setRetryAt(cause.retryAt);
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [attempt]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setTimeout(
      () => setAttempt((value) => value + 1),
      Math.max(0, retryAt - Date.now()) + 250,
    );
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    document.title = `${current?.name || "页面未找到"} · Elink`;
  }, [current]);

  const openSearch = () => {
    setSearch("");
    try {
      setSearchHistory(account ? loadHistory(localStorage, account.user_id) : []);
    } catch {
      setSearchHistory([]);
    }
    setSearchOpen(true);
  };
  const sidebar = (
    <>
      <Link className="workspace-brand" to="/" aria-label="Elink 首页">
        <span className="workspace-logo">
          <img key={logo} src={logo} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
        </span>
        <strong>
          Elink<span>创作工作台</span>
        </strong>
      </Link>
      <Button className="workspace-search" icon={<Search size={17} />} onClick={openSearch}>
        搜索应用与对话
      </Button>
      <nav aria-label="工作台导航">
        {(["workspace", "create"] as const).map((section) => (
          <div className="workspace-nav-section" key={section}>
            <div className="workspace-nav-caption">
              {section === "workspace" ? "工作空间" : "创作工具"}
            </div>
            {modules
              .filter((m) => m.section === section)
              .map((m) => (
                <ModuleLink
                  key={m.id}
                  module={m}
                  className="workspace-nav-item"
                >
                  <m.icon size={19} strokeWidth={1.7} />
                  <span>{m.name}</span>
                  {!m.ready && <small>待接入</small>}
                </ModuleLink>
              ))}
          </div>
        ))}
      </nav>
      <div className="workspace-sidebar-bottom">
        <div className="workspace-sidebar-rule" />
        <a className="workspace-account" href="/profile">
          <span className="workspace-avatar">
            {account?.username.slice(0, 1).toUpperCase() || "E"}
          </span>
          <span>
            <strong>{account?.username || "你的工作空间"}</strong>
            <small>账号与额度</small>
          </span>
          <ChevronsUpDown size={15} />
        </a>
      </div>
    </>
  );

  return (
    <div className="workspace-shell">
      <aside className="workspace-navigation">{sidebar}</aside>
      <Drawer
        title="Elink 工作台"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        placement="left"
        width={280}
      >
        <div className="workspace-drawer">{sidebar}</div>
      </Drawer>
      <main className={`workspace-surface${location.pathname === "/chat" ? " is-chat" : ""}`}>
        <header className="workspace-topbar">
          <div>
            <Button
              className="workspace-mobile-toggle"
              type="text"
              aria-label="打开工作台导航"
              icon={<Menu size={20} />}
              onClick={() => setMobileOpen(true)}
            />
            <span>{current?.name || "工作空间"}</span>
          </div>
          <div>
            <a href="/pricing" target="_blank" rel="noopener noreferrer">
              模型广场 <ArrowUpRight size={13} />
            </a>
            <Button
              type="text"
              aria-label={dark ? "使用浅色外观" : "使用深色外观"}
              icon={dark ? <Sun size={17} /> : <Moon size={17} />}
              onClick={onTheme}
            />
          </div>
        </header>
        {loading ? (
          <div className="workspace-loading">
            <Spin />
            <p>正在连接你的工作空间…</p>
          </div>
        ) : !account ? (
          <div className="workspace-loading">
            <Alert showIcon type="warning" message={error || "登录已过期，请返回主站重新登录。"} />
            {needsLogin ? (
              <Button
                href={`/sign-in?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                type="primary"
              >
                登录主站
              </Button>
            ) : (
              <Button type="primary" disabled={retryAt > 0} onClick={() => setAttempt((value) => value + 1)}>
                {retryAt > 0 ? "等待自动重试" : "重新连接"}
              </Button>
            )}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="workspace-loading">
                <Spin />
              </div>
            }
          >
            <Routes>
              <Route index element={<HomePage account={account} onAccountChange={setAccount} />} />
              <Route
                path="chat"
                element={
                  <ChatPage
                    account={account}
                    onSessionExpired={() => {
                      setAccount(undefined);
                      setNeedsLogin(true);
                      setError("登录已过期，请返回主站重新登录。");
                    }}
                  />
                }
              />
              {modules.map((m) => "href" in m ? (
                <Route key={m.id} path={m.id} element={<AppRedirect href={m.href} />} />
              ) : null)}
              {modules
                .filter((m) => !m.ready)
                .map((m) => (
                  <Route key={m.id} path={m.id} element={<ModulePage module={m} />} />
                ))}
              <Route
                path="*"
                element={
                  <div className="workspace-loading">
                    <h1>这个页面还不存在</h1>
                    <Link to="/">返回首页</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        )}
      </main>
      <Modal
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        title="搜索应用与对话"
        closeIcon={<X size={18} />}
      >
        <Input
          autoFocus
          aria-label="搜索应用与对话"
          prefix={<Search size={16} />}
          placeholder="输入应用名称或对话标题"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="workspace-search-results">
          {modules
            .filter((m) => m.name.includes(search.trim()))
            .map((m) => (
              <Button
                type="text"
                key={m.id}
                icon={<m.icon size={17} />}
                onClick={() => {
                  if ("href" in m) window.location.assign(m.href);
                  else void navigate(m.path);
                  setSearchOpen(false);
                }}
              >
                {m.name}
                {!m.ready ? " · 待接入" : ""}
              </Button>
            ))}
          {searchHistory
            .filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase()))
            .slice(0, 12)
            .map((s) => (
              <Button
                key={s.id}
                type="text"
                onClick={() => {
                  void navigate(`/chat?conversation=${encodeURIComponent(s.id)}`);
                  setSearchOpen(false);
                }}
              >
                {s.title}
              </Button>
            ))}
        </div>
      </Modal>
    </div>
  );
}
