import { Button, Tooltip } from "antd";
import { FileText, X } from "lucide-react";
import type { Attachment } from "../../types";

export default function AttachmentList({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="chat-attachments" aria-label={onRemove ? "待发送附件" : "消息附件"}>
      {items.map((file) => (
        <div className="chat-attachment" key={file.id}>
          {file.kind === "image" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(file.data) ? (
            <img src={file.data} alt={file.name} />
          ) : (
            <span className="attachment-icon">
              <FileText size={19} />
            </span>
          )}
          <span className="attachment-details">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {file.kind === "image" ? "图片" : "文本"} · {Math.max(1, Math.ceil(file.size / 1024))}{" "}
              KB
            </small>
          </span>
          {onRemove && (
            <Tooltip title="移除附件">
              <Button
                type="text"
                size="small"
                aria-label={`移除 ${file.name}`}
                icon={<X size={14} />}
                onClick={() => onRemove(file.id)}
              />
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );
}
