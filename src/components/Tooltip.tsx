"use client";

import { useEffect, useState } from "react";

type Tip = { text: string; x: number; y: number; tf: string; dark: boolean };

/**
 * Custom tooltips for any element with data-tip, replacing native title.
 * Dark surfaces get a light tip; collapsed-rail icons get a tip to the right.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let current: Element | null = null;
    const over = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-tip]");
      if (el === current) return;
      current = el;
      const text = el?.getAttribute("data-tip");
      if (!el || !text) return setTip(null);
      const b = el.getBoundingClientRect();
      let dark = false;
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).backgroundColor === "rgb(29, 26, 15)") {
          dark = true;
          break;
        }
      }
      if (b.left < 90 && b.width < 90) setTip({ text, dark, x: b.right + 8, y: b.top + b.height / 2, tf: "translateY(-50%)" });
      else {
        const below = b.top < 48;
        const x = Math.max(140, Math.min(window.innerWidth - 140, b.left + b.width / 2));
        setTip({ text, dark, x, y: below ? b.bottom + 8 : b.top - 8, tf: below ? "translateX(-50%)" : "translate(-50%,-100%)" });
      }
    };
    const clear = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", clear);
    window.addEventListener("scroll", clear, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", clear);
      window.removeEventListener("scroll", clear, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: "fixed", left: tip.x, top: tip.y, transform: tip.tf, zIndex: 50, pointerEvents: "none",
        background: tip.dark ? "#fff" : "#1D1A0F", color: tip.dark ? "#1D1A0F" : "#fff",
        fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, padding: "7px 11px", borderRadius: 8, maxWidth: 260,
        boxShadow: "0 6px 18px rgba(29,26,15,.22)", textWrap: "pretty",
      }}
    >
      {tip.text}
    </div>
  );
}
