import { computeLineDiff } from '../diff';

export interface DiffSegment {
  oldText: string;
  newText: string;
}

const PREFIX = { add: '+ ', del: '- ', ctx: '  ' } as const;
const LINE_CLASS = { add: 'diff-add', del: 'diff-del', ctx: 'diff-ctx' } as const;
const LINE_BG = { add: '#e6ffed', del: '#ffeef0', ctx: 'transparent' } as const;
const LINE_COLOR = { add: '#22863a', del: '#b31d28', ctx: '#444' } as const;

/**
 * 行级 diff 展示组件。
 * 接收编辑工具的 file_path 与一组 (old, new) 片段:
 *  - Edit:一段
 *  - MultiEdit:多段
 *  - Write:一段(old='', new=content,视为全新增)
 */
export function DiffView({ filePath, segments }: { filePath: string; segments: DiffSegment[] }) {
  return (
    <div
      className="diff-view"
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        borderRadius: '6px',
        border: '1px solid #e1e4e8',
        overflow: 'hidden',
        backgroundColor: '#fff',
      }}
    >
      <div
        className="diff-file-path"
        style={{
          padding: '0.4rem 0.75rem',
          backgroundColor: '#f6f8fa',
          borderBottom: '1px solid #e1e4e8',
          color: '#24292e',
          fontWeight: 600,
          wordBreak: 'break-all',
        }}
      >
        {filePath}
      </div>
      <div style={{ overflowX: 'auto' }}>
        {segments.map((seg, si) => {
          const lines = computeLineDiff(seg.oldText, seg.newText);
          return (
            <div key={si} className="diff-segment">
              {si > 0 && (
                <div
                  className="diff-segment-sep"
                  style={{ height: '1px', backgroundColor: '#e1e4e8' }}
                />
              )}
              {lines.map((line, li) => (
                <div
                  key={li}
                  className={LINE_CLASS[line.type]}
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    padding: '0 0.75rem',
                    backgroundColor: LINE_BG[line.type],
                    color: LINE_COLOR[line.type],
                    lineHeight: '1.5',
                  }}
                >
                  {PREFIX[line.type] + line.text}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
