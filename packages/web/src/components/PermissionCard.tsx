import type { PermissionPrompt, PermissionAnswer } from "@cc-web/shared";

export function PermissionCard({
  prompt,
  onAnswer,
}: {
  prompt: PermissionPrompt;
  onAnswer: (a: PermissionAnswer) => void;
}) {
  return (
    <div className="card card-permission">
      <div className="card-title">{prompt.title}</div>
      {prompt.detail && <pre className="card-detail">{prompt.detail}</pre>}
      <div className="card-actions">
        <button
          className="btn btn-allow"
          onClick={() =>
            onAnswer({ kind: "permission", id: prompt.id, decision: "allow" })
          }
        >
          ✓ 允许
        </button>
        <button
          className="btn btn-deny"
          onClick={() =>
            onAnswer({ kind: "permission", id: prompt.id, decision: "deny" })
          }
        >
          ✗ 拒绝
        </button>
      </div>
    </div>
  );
}
