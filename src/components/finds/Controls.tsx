"use client";

import { createPortal } from "react-dom";
import { ENDED_STAGES, STAGE_STYLE, STAGES } from "@/lib/board";
import type { Stage } from "@/lib/types";

export function Menu({ style, children, onClick }: { style: React.CSSProperties; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} role="menu" style={{ position: "absolute", zIndex: 6, background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.18)", padding: 6, display: "flex", flexDirection: "column", ...style }}>
      {children}
    </div>
  );
}

export function StageMenu({ current, onPick, style, mobile }: { current: Stage; onPick: (s: Stage) => void; style: React.CSSProperties; mobile?: boolean }) {
  return createPortal(
    <Menu style={{ position: "fixed", zIndex: 40, ...style }} onClick={(e) => e.stopPropagation()}>
      {STAGES.map((s, i) => (
        <div key={s} style={{ display: "contents" }}>
          {i === 4 && <div style={{ height: 1, background: "#EEEAE4", margin: "4px 6px" }} />}
          <button
            role="menuitem"
            className="h-menu"
            data-tip={ENDED_STAGES.includes(s) ? "Archives it" : undefined}
            onClick={(e) => { e.stopPropagation(); onPick(s); }}
            style={{ display: "flex", alignItems: "center", gap: 9, padding: mobile ? "0 10px" : "8px 10px", minHeight: mobile ? 40 : undefined, border: 0, borderRadius: 8, background: s === current ? "#F6F2EC" : "transparent", fontSize: mobile ? 14 : 13, fontWeight: 500, color: "#1D1A0F", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" }}
          >
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: STAGE_STYLE[s].bg, border: `1.5px solid ${STAGE_STYLE[s].bg}`, flex: "none" }} />
            {s}
          </button>
        </div>
      ))}
    </Menu>,
    document.body,
  );
}

export function IconBtn({ tip, onClick, style, pressed, children }: { tip: string; onClick: () => void; style: React.CSSProperties; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      data-tip={tip}
      aria-label={tip}
      aria-pressed={pressed}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, ...style }}
    >
      {children}
    </button>
  );
}

export function Switch({ on, onClick, tip, small, disabled }: { on: boolean; onClick: () => void; tip?: string; small?: boolean; disabled?: boolean }) {
  const w = small ? 28 : 40, h = small ? 16 : 22, k = small ? 12 : 16, p = small ? 2 : 3;
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={tip}
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
      style={{ width: w, height: h, borderRadius: 999, border: 0, padding: p, background: on ? "#99220F" : "#D8D0C4", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .15s", flex: "none" }}
    >
      <span style={{ width: k, height: k, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </button>
  );
}
