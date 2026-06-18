import { useEffect, useState } from "react";
import type { PlanPrompt, PlanAnswer } from "@coderelay/shared";

export function PlanCard({
  prompt,
  onAnswer,
}: {
  prompt: PlanPrompt;
  onAnswer: (a: PlanAnswer) => void;
}) {
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setAnswered(false);
  }, [prompt.id]);

  const handleAnswer = (decision: "approve" | "reject") => {
    if (answered) return;
    setAnswered(true);
    onAnswer({ kind: "plan", id: prompt.id, decision });
  };

  return (
    <div className="card card-plan">
      <div className="card-title">Claude 提交了一份计划</div>
      <pre className="card-detail card-plan-body">{prompt.plan}</pre>
      <div className="card-actions">
        <button
          className="btn btn-allow"
          disabled={answered}
          onClick={() => handleAnswer("approve")}
        >
          批准计划
        </button>
        <button
          className="btn btn-deny"
          disabled={answered}
          onClick={() => handleAnswer("reject")}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
