// Adapted from LobeHub v0.162.25 src/features/Conversation/components/ChatItem/index.tsx.
// Copyright (c) 2023 - current LobeHub. MIT; see ../../../LICENSE and NOTICE.
import { Button, Tooltip } from "antd";
import { Copy, RotateCcw, Sparkles } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../types";
import AttachmentList from "../chat/AttachmentList";

interface Props {
  item: Message;
  generating: boolean;
  onCopy: (text: string) => void;
  onRetry?: () => void;
}

export default memo(function Item({ item, generating, onCopy, onRetry }: Props) {
  const isUser = item.role === "user";
  return (
    <article
      className={`chat-message ${isUser ? "is-user" : "is-assistant"}`}
      aria-label={isUser ? "你的消息" : "助手回复"}
    >
      {!isUser && (
        <span className="assistant-avatar">
          <Sparkles size={18} />
        </span>
      )}
      <div className="message-body">
        <div className="message-meta">
          <span>{isUser ? "你" : item.model || "AI 助手"}</span>
          <time dateTime={new Date(item.createdAt).toISOString()}>
            {new Date(item.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        {!!item.attachments?.length && <AttachmentList items={item.attachments} />}
        {item.reasoning && (
          <details className="message-reasoning">
            <summary>{generating ? "正在思考" : "思考过程"}</summary>
            <p>{item.reasoning}</p>
          </details>
        )}
        {item.content ? (
          <div className="message-content markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                a: (props) => (
                  <a href={props.href} target="_blank" rel="noopener noreferrer">
                    {props.children}
                  </a>
                ),
                // Model-generated URLs must not issue image requests to tracking or private endpoints.
                img: (props) => <span>[图片：{props.alt || "未加载"}]</span>,
              }}
            >
              {item.content}
            </ReactMarkdown>
          </div>
        ) : generating ? (
          <div className="message-pending" role="status">
            <span />
            正在生成回复…
          </div>
        ) : !isUser && !item.error ? (
          <div className="message-empty">这次没有收到正文，可以切换模型后重试。</div>
        ) : null}
        {item.error && (
          <div role="alert" className="message-error">
            {item.error}
          </div>
        )}
        {!generating && (
          <div className="message-actions">
            {!!item.content && (
              <Tooltip title="复制">
                <Button
                  size="small"
                  type="text"
                  aria-label="复制"
                  icon={<Copy size={14} />}
                  onClick={() => onCopy(item.content)}
                />
              </Tooltip>
            )}
            {onRetry && (
              <Tooltip title="重新生成">
                <Button
                  size="small"
                  type="text"
                  aria-label="重新生成"
                  icon={<RotateCcw size={14} />}
                  onClick={onRetry}
                />
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
