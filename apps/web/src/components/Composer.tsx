import { useRef, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { uploadFile } from "../chatApi.js";
import { AttachmentPreview, type Attachment } from "./AttachmentPreview.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

export function Composer({
  disabled,
  executing,
  onSend,
  onAbort,
  modeControl,
}: {
  disabled: boolean;
  executing?: boolean;
  onSend: (text: string, attachments: string[]) => void | Promise<void>;
  onAbort?: () => void;
  modeControl?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
      // Revoke Blob URLs before clearing attachments
      attachments.forEach((a) => {
        if (a.previewUrl) {
          URL.revokeObjectURL(a.previewUrl);
        }
      });
      setText("");
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }

  // Cleanup: revoke all Blob URLs on unmount
  useEffect(() => {
    const currentAttachments = attachments;
    return () => {
      // Capture attachments at mount time for cleanup
      currentAttachments.forEach((a) => {
        if (a.previewUrl) {
          URL.revokeObjectURL(a.previewUrl);
        }
      });
    };
  }, [attachments]);

  return (
    <div className="composer">
      <AttachmentPreview
        items={attachments}
        onRemove={(ref) => {
          setAttachments((prev) => {
            // Find the attachment being removed
            const removed = prev.find((a) => a.ref === ref);
            // Revoke its Blob URL if it has one
            if (removed?.previewUrl) {
              URL.revokeObjectURL(removed.previewUrl);
            }
            return prev.filter((a) => a.ref !== ref);
          });
        }}
      />
      <div className="composer-row">
        <button
          className="composer-btn"
          title="上传图片"
          aria-label="选择图片"
          onClick={() => imageInput.current?.click()}
        >
          🖼️
        </button>
        <input
          ref={imageInput}
          type="file"
          hidden
          aria-label="上传图片"
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files, true)}
        />
        {modeControl}
        <textarea
          className="composer-input"
          value={text}
          placeholder="输入消息…"
          rows={1}
          disabled={disabled || sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 修复 P2-F6: IME 输入法确认候选词时不触发发送
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
