import { useState } from "react";
import type { PermissionPrompt, PermissionAnswer } from "@cc-web/shared";

export function PermissionCard({
  prompt,
  onAnswer,
}: {
  prompt: PermissionPrompt;
  onAnswer: (a: PermissionAnswer) => void;
}) {
  const [answered, setAnswered] = useState(false);

  const handleAnswer = (decision: "allow" | "deny") => {
    if (answered) return;
    setAnswered(true);
    onAnswer({ kind: "permission", id: prompt.id, decision });
  };

  return (
    <div className="card card-permission">
      <div className="card-title">{prompt.title}</div>
      {prompt.detail && <pre className="card-detail">{prompt.detail}</pre>}
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
