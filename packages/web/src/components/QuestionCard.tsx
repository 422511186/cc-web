import { useState } from "react";
import type { QuestionPrompt, QuestionAnswer } from "@cc-web/shared";

export function QuestionCard({
  prompt,
  onAnswer,
}: {
  prompt: QuestionPrompt;
  onAnswer: (a: QuestionAnswer) => void;
}) {
  // selected[qIndex] = 已选 label 集合
  const [selected, setSelected] = useState<string[][]>(
    prompt.questions.map(() => [])
  );
  const [submitted, setSubmitted] = useState(false);

  function toggle(qi: number, label: string, multi: boolean) {
    setSelected((prev) => {
      const next = prev.map((arr) => [...arr]);
      if (multi) {
        const i = next[qi].indexOf(label);
        if (i >= 0) next[qi].splice(i, 1);
        else next[qi].push(label);
      } else {
        next[qi] = [label];
      }
      return next;
    });
  }

  const allAnswered = selected.every((arr) => arr.length > 0);

  const handleSubmit = () => {
    if (submitted) return;
    setSubmitted(true);
    onAnswer({ kind: "question", id: prompt.id, answers: selected });
  };

  return (
    <div className="card card-question">
      {prompt.questions.map((q, qi) => (
        <div key={qi} className="question-block">
          <div className="card-label">{q.header}</div>
          <div className="card-title">{q.question}</div>
          <div className="options">
            {q.options.map((opt, oi) => {
              const letter = String.fromCharCode(65 + oi);
              const isSel = selected[qi].includes(opt.label);
              return (
                <button
                  key={oi}
                  className={`option ${isSel ? "option-selected" : ""}`}
                  onClick={() => toggle(qi, opt.label, q.multiSelect)}
                >
                  <span className="option-letter">{letter}</span>
                  <span className="option-body">
                    <span className="option-label">{opt.label}</span>
                    <span className="option-desc">{opt.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="card-actions">
        <button
          className="btn btn-allow"
          disabled={!allAnswered || submitted}
          onClick={handleSubmit}
        >
          提交
        </button>
      </div>
    </div>
  );
}
