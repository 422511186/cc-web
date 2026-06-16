import { useRef, useState } from "react";
import { uploadFile } from "../chatApi.js";
import { AttachmentPreview, type Attachment } from "./AttachmentPreview.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

export function Composer({
  disabled,
  executing,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  executing?: boolean;
  onSend: (text: string, attachments: string[]) => void | Promise<void>;
  onAbort?: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null, asImage: boolean) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const { ref, filename } = await uploadFile(file);
      setAttachments((prev) => [
        ...prev,
        {
          ref,
          filename,
          previewUrl: asImage ? URL.createObjectURL(file) : undefined,
        },
      ]);
    }
  }

  async function submit() {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    setSending(true);
    try {
      await onSend(
        trimmed,
        attachments.map((a) => a.ref)
      );
      setText("");
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <AttachmentPreview
        items={attachments}
        onRemove={(ref) =>
          setAttachments((prev) => prev.filter((a) => a.ref !== ref))
        }
      />
      <div className="composer-row">
        <button
          className="composer-btn"
          title="附件"
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
        <button
          className="composer-btn"
          title="图片"
          onClick={() => imageInput.current?.click()}
        >
          🖼️
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => handleFiles(e.target.files, false)}
        />
        <input
          ref={imageInput}
          type="file"
          hidden
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files, true)}
        />
        <textarea
          className="composer-input"
          value={text}
          placeholder="输入消息…"
          rows={1}
          disabled={disabled || sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {executing ? (
          <button
            className="composer-send"
            onClick={() => setShowConfirm(true)}
          >
            ⏹ 停止
          </button>
        ) : (
          <button
            className="composer-send"
            disabled={disabled || sending}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
      <ConfirmDialog
        open={showConfirm}
        title="确认停止"
        message="确定要停止当前执行吗？"
        onConfirm={() => {
          setShowConfirm(false);
          onAbort?.();
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
