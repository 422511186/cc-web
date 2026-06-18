import { useEffect, useState } from "react";
import type { PermissionPrompt, PermissionAnswer } from "@coderelay/shared";

export function PermissionCard({
  prompt,
  onAnswer,
}: {
  prompt: PermissionPrompt;
  onAnswer: (a: PermissionAnswer) => void;
}) {
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setAnswered(false);
  }, [prompt.id]);

  const handleAnswer = (decision: "allow" | "deny") => {
    if (answered) return;
    setAnswered(true);
    onAnswer({ kind: "permission", id: prompt.id, decision });
  };

  return (
    <div className="card card-permission">
      <div className="card-title">{prompt.title}</div>
      {prompt.detail && <pre className="card-detail">{prompt.detail}</pre>}
      {prompt.diff && (
        <div className="diff-preview" style={{
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          backgroundColor: '#f6f8fa',
          border: '1px solid #e1e4e8',
          borderRadius: '6px',
          padding: '0.5rem',
          maxHeight: '300px',
          overflowY: 'auto',
          whiteSpace: 'pre',
          margin: '0.5rem 0',
        }}>
          {prompt.diff.split('\n').map((line, i) => {
            let color = '#24292e';
            let bg = 'transparent';
            if (line.startsWith('+')) {
              color = '#22863a';
              bg = '#e6ffed';
            } else if (line.startsWith('-')) {
              color = '#b31d28';
              bg = '#ffeef0';
            } else if (line.startsWith('@@')) {
              color = '#005cc5';
              bg = '#f1f8ff';
            }
            return (
              <div key={i} style={{ color, backgroundColor: bg }}>
                {line || ' '}
              </div>
            );
          })}
        </div>
      )}
      <div className="card-actions">
        <button
          className="btn btn-allow"
          disabled={answered}
          onClick={() => handleAnswer("allow")}
        >
          ✓ 允许
        </button>
        <button
          className="btn btn-deny"
          disabled={answered}
          onClick={() => handleAnswer("deny")}
        >
          ✗ 拒绝
        </button>
      </div>
    </div>
  );
}
