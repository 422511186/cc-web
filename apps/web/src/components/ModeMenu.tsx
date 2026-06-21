import { useState } from "react";
import type { ClaudeSessionMode } from "@coderelay/shared";

const MODE_OPTIONS: Array<{
  value: ClaudeSessionMode;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    value: "default",
    label: "Ask before edits",
    description: "Claude will ask for approval before making each edit",
    icon: "□",
  },
  {
    value: "acceptEdits",
    label: "Edit automatically",
    description: "Claude will edit selected files without asking each time",
    icon: "<>",
  },
  {
    value: "plan",
    label: "Plan mode",
    description: "Claude will explore and present a plan before editing",
    icon: "▤",
  },
  {
    value: "auto",
    label: "Auto mode",
    description: "Claude will choose the best permission mode for each task",
    icon: "↯",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    description: "Claude will not ask before running dangerous commands",
    icon: "⌘",
  },
];

export function ModeMenu({
  mode,
  disabled,
  onModeChange,
}: {
  mode: ClaudeSessionMode;
  disabled?: boolean;
  onModeChange: (mode: ClaudeSessionMode) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const selected = MODE_OPTIONS.find((option) => option.value === mode) ?? MODE_OPTIONS[3];

  return (
    <div
      className="mode-menu"
      style={{ position: "relative", flex: "0 0 auto" }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="mode-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Modes"
        style={{
          height: "2.5rem",
          minWidth: "7.5rem",
          border: "1px solid #d0d7de",
          borderRadius: 10,
          background: "#f6f8fa",
          color: "#24292f",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.4rem",
          padding: "0 0.65rem",
          fontSize: "0.86rem",
          fontWeight: 650,
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden="true" style={{ color: "#57606a", fontFamily: "monospace" }}>
          {selected.icon}
        </span>
        <span>{selected.label}</span>
        <span aria-hidden="true" style={{ color: "#57606a", fontSize: "0.72rem" }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="mode-menu-panel"
          role="menu"
          aria-label="Modes"
          style={{
            position: "absolute",
            left: "-3.25rem",
            bottom: "calc(100% + 0.5rem)",
            width: "min(28rem, calc(100vw - 1.5rem))",
            maxHeight: "min(24rem, 70vh)",
            overflow: "auto",
            border: "1px solid #d0d7de",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 16px 48px rgba(31, 35, 40, 0.18)",
            padding: "0.45rem",
            zIndex: 20,
          }}
        >
          <div style={{ color: "#57606a", fontSize: "0.78rem", padding: "0.35rem 0.55rem 0.45rem" }}>
            Modes
          </div>
          {MODE_OPTIONS.map((option) => {
            const active = option.value === mode;
            return (
              <button
                className="mode-menu-item"
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) void onModeChange(option.value);
                }}
                style={{
                  width: "100%",
                  border: 0,
                  borderRadius: 6,
                  background: active ? "#ddf4ff" : "#fff",
                  color: "#24292f",
                  cursor: "pointer",
                  display: "grid",
                  gridTemplateColumns: "1.8rem minmax(0, 1fr) 1.25rem",
                  gap: "0.6rem",
                  alignItems: "center",
                  padding: "0.6rem 0.55rem",
                  textAlign: "left",
                }}
              >
                <span aria-hidden="true" style={{ color: active ? "#0969da" : "#6e7781", fontFamily: "monospace" }}>
                  {option.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 650, fontSize: "0.9rem" }}>
                    {option.label}
                  </span>
                  <span style={{ display: "block", color: "#57606a", fontSize: "0.78rem", lineHeight: 1.35, marginTop: "0.15rem" }}>
                    {option.description}
                  </span>
                </span>
                <span aria-hidden="true" style={{ color: "#0969da", fontWeight: 700, textAlign: "center" }}>
                  {active ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
