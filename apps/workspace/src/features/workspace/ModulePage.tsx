import { ArrowRight, ArrowUpRight, Check, CircleDashed } from "lucide-react";
import { Link } from "react-router";
import type { WorkspaceModule } from "./modules";

const details: Record<string, { items: string[]; note: string }> = {
  sites: {
    items: [
      "通过对话生成与修改页面",
      "独立预览、版本历史与资源引用",
      "确认后发布，随时返回继续编辑",
    ],
    note: "建站功能尚未接入。后续会在这里提供从创作、预览到发布的完整流程。",
  },
  tasks: {
    items: ["汇总图片、视频与建站任务", "区分排队、运行、完成与失败", "从任务直接打开生成的作品"],
    note: "统一任务中心尚未连接执行服务。这里不会把聊天记录或演示数据当作真实任务展示。",
  },
  resources: {
    items: [
      "统一查看生成与上传的素材",
      "记录来源、所属项目与使用关系",
      "在图像、视频与网站间复用资源",
    ],
    note: "统一资源库尚未连接素材服务。已有创作素材继续保留在原工作区中。",
  },
};

export default function ModulePage({ module }: { module: WorkspaceModule }) {
  const detail = details[module.id];
  return (
    <div className={`module-page module-${module.id}`}>
      <div className="module-intro">
        <span className="module-icon">
          <module.icon size={36} strokeWidth={1.3} />
        </span>
        <span className="module-status">
          <CircleDashed size={14} /> 待接入
        </span>
        <h1>{module.name}</h1>
        <p>{module.description}</p>
      </div>
      <div className="module-plan">
        <h2>接下来，这里可以做什么</h2>
        {detail.items.map((item) => (
          <div key={item}>
            <Check size={16} />
            <span>{item}</span>
          </div>
        ))}
        <p>{detail.note}</p>
        {module.id !== "sites" && (
          <a
            className="module-studio"
            href="/apps/studio/"
            target="_blank"
            rel="noopener noreferrer"
          >
            打开创作应用 <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <Link className="module-back" to="/">
        回到首页，继续探索 <ArrowRight size={15} />
      </Link>
    </div>
  );
}
