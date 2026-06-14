import type { PlanPrompt, PlanAnswer } from "@cc-web/shared";

export function PlanCard({
  prompt,
  onAnswer,
}: {
  prompt: PlanPrompt;
  onAnswer: (a: PlanAnswer) => void;
}) {
  return (
    <div className="card card-plan">
      <div className="card-title">Claude 提交了一份计划</div>
      <pre className="card-detail card-plan-body">{prompt.plan}</pre>
      <div className="card-actions">
        <button
          className="btn btn-allow"
          onClick={() =>
            onAnswer({ kind: "plan", id: prompt.id, decision: "approve" })
          }
        >
          批准计划
        </button>
        <button
          className="btn btn-deny"
          onClick={() =>
            onAnswer({ kind: "plan", id: prompt.id, decision: "reject" })
          }
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
