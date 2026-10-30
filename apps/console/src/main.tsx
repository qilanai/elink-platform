import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Application, ApplicationCatalog, ApplicationID } from '@elink/contracts';
import './styles.css';

const content = {
  studio: {
    name: 'Studio', subtitle: '图片与视频创作', number: '01',
    description: '从一张灵感图，到一段完整的故事。在同一个空间生成图片、构思分镜、创作与剪辑视频。',
    tags: ['图片生成', '视频创作', '画布与分镜', '剪辑导出'], action: '进入创作空间',
  },
  sites: {
    name: 'Sites', subtitle: 'AI 建站', number: '02',
    description: '把想法变成可访问的网站。用对话搭建页面，让创作素材成为品牌的一部分。',
    tags: ['对话建站', '可视化编辑', '网站发布'], action: '即将开放',
  },
  gateway: {
    name: '模型控制台', subtitle: '模型与用量', number: '03',
    description: '管理模型访问凭证，查看余额与调用记录。',
    tags: ['模型服务', '调用记录'], action: '打开控制台',
  },
} satisfies Record<ApplicationID, object>;

function AppCard({ application }: { application: Application }) {
  const copy = content[application.id];
  const enabled = application.state === 'available';
  return (
    <article className={`app-card ${application.id}`} aria-labelledby={`${application.id}-title`}>
      <div className="card-top"><span className="card-number">{copy.number}</span>
        <span className={`status ${application.state}`}>
          {enabled ? '可访问' : application.state === 'planned' ? '即将开放' : '暂不可用'}
        </span>
      </div>
      {application.id === 'studio' && <div className="studio-art" aria-hidden="true">
        <div className="art-grid" /><div className="image-frame"><div className="sun" /><div className="mountain" /></div>
        <div className="video-frame"><span>▶</span><div className="timeline-bars"><i /><i /><i /><i /><i /></div></div>
        <span className="art-label">想象，从这里开始</span>
      </div>}
      {application.id === 'sites' && <div className="sites-art" aria-hidden="true">
        <div className="browser-frame"><div className="browser-dots">● ● ●</div><div className="browser-body"><div /><div /><div /><div /></div></div>
      </div>}
      <div className="card-copy">
        <p className="eyebrow">{copy.subtitle}</p><h2 id={`${application.id}-title`}>{copy.name}</h2>
        <p className="description">{copy.description}</p>
        <ul className="tags">{copy.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
        {enabled && application.url
          ? <a className="launch" href={application.url}>{copy.action}<span aria-hidden="true">↗</span></a>
          : <button className="launch" disabled>{application.state === 'planned' ? '即将开放' : '应用暂不可用'}<span aria-hidden="true">↗</span></button>}
      </div>
    </article>
  );
}

function App() {
  const [catalog, setCatalog] = useState<ApplicationCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setFailed(false);
    async function load() {
      try {
        const response = await fetch('/api/platform/v1/applications', { signal: controller.signal });
        if (!response.ok) throw new Error('Catalog unavailable');
        const data: ApplicationCatalog = await response.json();
        setCatalog(data);
      } catch {
        if (!disposed) { setFailed(true); setCatalog(null); }
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [refresh]);

  return <div className="shell">
    <header><a href="/" className="brand" aria-label="Elink 创作空间首页"><span className="brand-mark" aria-hidden="true">e</span><span>elink<span className="brand-divider">/</span><span className="brand-space">创作空间</span></span></a><span className="workspace-label">让灵感成为作品</span></header>
    <main>
      <div className="intro"><div><p className="eyebrow">YOUR CREATIVE SPACE</p><h1>从想法，到作品<span>。</span></h1><p>选择你的创作工具，开始下一件作品。</p></div><span className="intro-index" aria-hidden="true">CREATE<br />SOMETHING<br /><strong>NEW ↗</strong></span></div>
      <div className="section-label"><span>全部应用</span><button className="refresh" onClick={() => setRefresh(value => value + 1)}>刷新状态 <span aria-hidden="true">↻</span></button></div>
      {failed ? <div className="notice" role="alert">暂时无法加载应用。请稍后重试。<button onClick={() => setRefresh(value => value + 1)}>重新加载</button></div>
        : !catalog ? <p className="loading" role="status">正在加载创作空间…</p>
        : <div className="app-grid">{catalog.applications.map(application => <AppCard key={application.id} application={application} />)}</div>}
      <p className="account-note">目前各应用使用独立账号登录，统一账号正在接入中。</p>
    </main>
    <footer><span>© {new Date().getFullYear()} Elink</span><span>Studio 基于 <a href="https://github.com/ddcat-ai/open-ai-canvas" target="_blank" rel="noreferrer">open-ai-canvas</a> · 模型服务基于 <a href="https://github.com/QuantumNous/new-api" target="_blank" rel="noreferrer">new-api</a></span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
