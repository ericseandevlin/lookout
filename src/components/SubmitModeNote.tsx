import { SUBMIT_LABEL, type SubmitMode } from "@/lib/application/submitMode";
import { color, font } from "@/lib/tokens";

/** Who presses Submit on this application (#187), said plainly before anyone approves anything. */
export function SubmitModeNote({ submit, compact }: { submit: SubmitMode; compact?: boolean }) {
  const auto = submit.mode === "auto";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: font.base }}>
      <span style={{ padding: "3px 10px", borderRadius: 999, fontWeight: 600, whiteSpace: "nowrap", background: auto ? "#E3EFDD" : color.surface, color: auto ? color.greenText : "#3B362C" }}>{SUBMIT_LABEL[submit.mode]}</span>
      {!compact && <span style={{ color: color.t2 }}>{submit.why}</span>}
    </div>
  );
}
