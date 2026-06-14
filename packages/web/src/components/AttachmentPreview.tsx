export interface Attachment {
  ref: string;
  filename: string;
  /** 图片类型时的本地预览 URL */
  previewUrl?: string;
}

export function AttachmentPreview({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (ref: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="attachments">
      {items.map((a) => (
        <div key={a.ref} className="attachment">
          {a.previewUrl ? (
            <img
              src={a.previewUrl}
              alt={a.filename}
              className="attachment-thumb"
            />
          ) : (
            <span className="attachment-file">📄 {a.filename}</span>
          )}
          <button
            className="attachment-remove"
            onClick={() => onRemove(a.ref)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
