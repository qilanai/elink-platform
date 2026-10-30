import { useMemo, useState } from "react";
import { Alert, Button, Input, Select } from "antd";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { bootstrap } from "../../lib/api";
import { loadHistory } from "../../lib/history";
import type { Bootstrap } from "../../types";
import { modules } from "./modules";
import ModuleLink from "./ModuleLink";

const starters = [
  {
    icon: FileText,
    title: "写一份好文案",
    description: "从零散想法，到清晰有力的表达",
    prompt: "请帮我写一份文案，先问我目标读者、主题和希望传达的信息。",
  },
  {
    icon: ListChecks,
    title: "把想法变成计划",
    description: "拆解目标，找到可以开始的下一步",
    prompt: "我想把一个想法变成可执行的计划，请先帮我梳理目标和限制条件。",
  },
  {
    icon: Lightbulb,
    title: "一起探索新主题",
    description: "理清问题，发现不同的思考方向",
    prompt: "我想深入了解一个主题，请引导我明确问题，并列出值得探索的方向。",
  },
];

export default function HomePage({
  account,
  onAccountChange,
}: {
  account: Bootstrap;
  onAccountChange: (data: Bootstrap) => void;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [group, setGroup] = useState(account.group);
  const [model, setModel] = useState(account.models[0] || "");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const groups = [...new Set([account.group, ...account.catalog.flatMap((m) => m.groups)])].sort();
  const available = account.catalog.filter((m) => m.groups.includes(group));
  const history = useMemo(() => {
    try {
      return { sessions: loadHistory(localStorage, account.user_id), error: "" };
    } catch {
      return { sessions: [], error: "本机对话记录暂时无法读取，原始数据已保留。" };
    }
  }, [account.user_id]);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const begin = () => {
    if (!text.trim() || !available.some((m) => m.id === model)) return;
    void navigate("/chat", { state: { draft: { text: text.trim(), model, group } } });
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await bootstrap();
      if (data.user_id !== account.user_id) {
        window.location.reload();
        return;
      }
      onAccountChange(data);
      setError("");
      if (!data.catalog.some((m) => m.id === model && m.groups.includes(group))) {
        setGroup(data.group);
        setModel(data.models[0] || "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="workspace-home">
      <section className="home-heading">
        <div>
          <div className="home-eyebrow">
            <span /> YOUR CREATIVE SPACE
          </div>
          <h1>
            {greeting}，{account.username}。
          </h1>
          <p>一个想法，可以有很多种可能。</p>
        </div>
        <div className="home-orbit" aria-hidden="true">
          <span className="orbit-one" />
          <span className="orbit-two" />
          <span className="orbit-three" />
          <Sparkles size={37} strokeWidth={1.2} />
        </div>
      </section>
      <div className="home-compose-layout">
        <section className="home-compose-card" aria-label="创作入口">
          <Input.TextArea
            aria-label="描述你的想法"
            placeholder="提问、整理灵感，或开始一个新创作…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 4, maxRows: 7 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                begin();
              }
            }}
          />
          <div className="home-compose-controls">
            <span className="home-mode">
              <MessageSquare size={16} /> 对话
            </span>
            <div className="home-model-controls">
              <Select
                aria-label="首页选择分组"
                value={group}
                options={groups.map((g) => ({ value: g, label: g }))}
                onChange={(g) => {
                  setGroup(g);
                  const next = account.catalog.filter((m) => m.groups.includes(g));
                  setModel(next.some((m) => m.id === model) ? model : next[0]?.id || "");
                }}
              />
              <Select
                aria-label="首页选择模型"
                showSearch
                optionFilterProp="label"
                placeholder="暂无可用模型"
                value={model || undefined}
                options={available.map((m) => ({ value: m.id, label: m.id }))}
                onChange={setModel}
              />
              <Button
                type="text"
                aria-label="刷新首页模型"
                loading={refreshing}
                icon={<RefreshCw size={15} />}
                onClick={() => void refresh()}
              />
              <Button
                className="home-send"
                type="primary"
                shape="circle"
                aria-label="开始对话"
                icon={<ArrowUp size={21} />}
                disabled={!text.trim() || !available.some((m) => m.id === model)}
                onClick={begin}
              />
            </div>
          </div>
          <div className="home-compose-note">
            选择模型后进入对话，继续完善你的想法。
            <Link to="/chat">
              打开聊天 <ArrowUpRight size={13} />
            </Link>
          </div>
        </section>
        <aside className="home-guide">
          <div className="home-guide-heading">
            <Sparkles size={16} />
            <span>让灵感开始生长</span>
          </div>
          <h2>
            你的下一件作品，
            <br />
            从这里开始。
          </h2>
          <p>
            对话、画面、镜头与网站，
            <br />
            逐步连接在同一个工作空间。
          </p>
          <a href="/apps/studio/?mode=video">
            开始视频创作 <ArrowUpRight size={15} />
          </a>
        </aside>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {!available.length && (
        <Alert
          type="info"
          showIcon
          message="当前分组暂无可用聊天模型，请切换分组或在主站配置后刷新。"
        />
      )}
      <section className="home-section">
        <div className="home-section-title">
          <h2>从一个想法开始</h2>
          <span>选择适合你的创作方式</span>
        </div>
        <div className="home-tools">
          {modules
            .filter((m) => m.id === "chat" || m.section === "create")
            .map((m) => (
              <ModuleLink key={m.id} module={m} className={`home-tool tool-${m.id}`}>
                <div className="home-tool-top">
                  <span className="home-tool-icon">
                    <m.icon size={23} strokeWidth={1.5} />
                  </span>
                  <span className={`home-tool-status${m.ready ? " ready" : ""}`}>
                    {m.ready ? "已就绪" : "待接入"}
                  </span>
                </div>
                <h3>{m.name}</h3>
                <p>{m.description}</p>
                <span className="home-tool-arrow">
                  <ArrowUpRight size={17} />
                </span>
              </ModuleLink>
            ))}
        </div>
      </section>
      <div className="home-bottom-grid">
        <section className="home-section">
          <div className="home-section-title">
            <h2>不知道从哪开始？</h2>
          </div>
          <div className="home-starters">
            {starters.map((item) => (
              <Button
                type="text"
                key={item.title}
                onClick={() => {
                  setText(item.prompt);
                  document
                    .querySelector<HTMLTextAreaElement>('[aria-label="描述你的想法"]')
                    ?.focus();
                }}
              >
                <item.icon size={20} strokeWidth={1.5} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowRight size={16} />
              </Button>
            ))}
          </div>
        </section>
        <section className="home-section">
          <div className="home-section-title">
            <h2>最近对话</h2>
            <span>保存在此浏览器</span>
          </div>
          {history.error ? (
            <p className="home-empty">{history.error}</p>
          ) : history.sessions.length ? (
            <div className="home-recents">
              {history.sessions.slice(0, 3).map((s) => (
                <Link key={s.id} to={`/chat?conversation=${encodeURIComponent(s.id)}`}>
                  <MessageSquare size={17} />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.model || "尚未选择模型"}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="home-empty">
              <MessageSquare size={25} strokeWidth={1.3} />
              <p>还没有对话，先和一个想法聊聊。</p>
              <Link to="/chat">
                开始第一段对话 <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
