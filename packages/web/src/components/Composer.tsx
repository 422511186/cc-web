import { useRef, useState } from "react";
import { uploadFile } from "../chatApi.js";
import { AttachmentPreview, type Attachment } from "./AttachmentPreview.js";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, attachments: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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

  function submit() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(
      trimmed,
      attachments.map((a) => a.ref)
    );
    setText("");
    setAttachments([]);
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="composer-send" disabled={disabled} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  );
}
