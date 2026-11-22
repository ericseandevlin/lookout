"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { color, font } from "@/lib/tokens";

/**
 * Chat pieces shared by the interview page and the keyword interview on the review page (#1449, #1485): bubbles,
 * the question with its reason in a tooltip, and the answer box with Skip and Send inside it.
 */

// The person's answers sit in a light gray bubble; Lookout's lines are plain text, like a chat with Claude.
export const bubble = (you: boolean): React.CSSProperties => ({
  position: "relative", maxWidth: 620, fontSize: font.lg, lineHeight: 1.5, textWrap: "pretty", whiteSpace: "pre-wrap",
  ...(you ? { padding: "11px 15px", borderRadius: 14, background: color.surface } : { padding: "2px 0" }),
});

export function Said({ who, children, id, rise }: { who: "Lookout" | "You"; children: React.ReactNode; id?: string; rise?: boolean }) {
  const you = who === "You";
  return (
    <div id={id} className={rise ? "lk-rise" : undefined} style={{ display: "flex", flexDirection: "column", alignItems: you ? "flex-end" : "flex-start", scrollMarginTop: 80 }}>
      <div style={bubble(you)}>
        <span className="sr-only">{you ? "You said: " : "Lookout: "}</span>
        {children}
      </div>
    </div>
  );
}

/** Where Lookout's reply will appear while it reads an answer: three soft dots, like a chat app (#1449). */
export function Thinking() {
  return (
    <div role="status" style={{ display: "flex", alignItems: "flex-start" }}>
      <span className="sr-only">Lookout is thinking</span>
      <span className="lk-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

// Only one tooltip is open at a time: opening one closes the last (#1449).
let closeOpen: (() => void) | null = null;

/**
 * A small button with a tooltip that opens on hover, on keyboard focus and on tap. A tap pins it until the next tap, a
 * tap outside or Escape; a mouse click doesn't, so it closes when the mouse leaves. It closes on blur and on scroll,
 * or with followScroll it moves with its button inside a scroll box (focus can scroll the chat) and closes once the
 * button leaves it. The tip is drawn on document.body, so a scroll box or a dialog can't clip it.
 */
export function TapTip({ tip, label, children, style, className, followScroll }: { tip: string; label?: string; children: React.ReactNode; style: React.CSSProperties; className?: string; followScroll?: boolean }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef("mouse");
  const tipId = useId();
  const open = hover || pinned;
  useLayoutEffect(() => {
    const el = btnRef.current;
    if (!open || !el) return setAt(null);
    const close = () => (setHover(false), setPinned(false));
    if (closeOpen && closeOpen !== close) closeOpen();
    closeOpen = close;
    const place = () => {
      const b = el.getBoundingClientRect();
      const box = el.closest("[data-chat-scroll]")?.getBoundingClientRect();
      if (box && (b.bottom < box.top || b.top > box.bottom)) return close();
      const below = b.top < 140;
      setAt({ x: Math.max(156, Math.min(window.innerWidth - 156, b.left + b.width / 2)), y: below ? b.bottom + 8 : b.top - 8, below });
    };
    place();
    const onScroll = followScroll ? place : close;
    const outside = (e: PointerEvent) => !el.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      if (closeOpen === close) closeOpen = null;
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, followScroll]);
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={() => pointer.current !== "mouse" && setPinned(!pinned)}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && (setHover(false), setPinned(false))}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(true)}
        onBlur={() => (setHover(false), setPinned(false))}
        onKeyDown={(e) => e.key === "Escape" && (setHover(false), setPinned(false))}
        aria-label={label}
        aria-describedby={tipId}
        data-open={open || undefined}
        className={className}
        style={style}
      >
        {children}
      </button>
      <span id={tipId} className="sr-only">{tip}</span>
      {at &&
        createPortal(
          <div
            aria-hidden="true"
            data-interview-tip=""
            style={{
              position: "fixed", left: at.x, top: at.y, transform: at.below ? "translateX(-50%)" : "translate(-50%,-100%)",
              zIndex: 50, pointerEvents: "none", width: "max-content", maxWidth: 296, background: color.ink, color: "#fff",
              fontSize: font.base, fontWeight: 500, lineHeight: 1.4, padding: "8px 12px", borderRadius: 8, boxShadow: "0 6px 18px rgba(29,26,15,.22)", textWrap: "pretty", whiteSpace: "pre-line",
            }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The quiet info icon: small, muted, no background, a little stronger on hover or focus (.lk-info). The button keeps a
 * 28px target around the 14px glyph so a finger can hit it.
 */
export function InfoIcon({ tip, label, followScroll }: { tip: string; label: string; followScroll?: boolean }) {
  return (
    <TapTip
      tip={tip}
      label={label}
      followScroll={followScroll}
      className="lk-info"
      style={{ display: "inline-flex", verticalAlign: "middle", margin: "-6px -4px -4px 0", width: 28, height: 28, padding: 0, border: 0, background: "transparent", color: color.t2, cursor: "help", alignItems: "center", justifyContent: "center" }}
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11v5.5" />
        <circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
      </svg>
    </TapTip>
  );
}

/** Lookout's question, as plain text. The quiet info icon at its end shows the reason as a tooltip. */
export function QuestionBubble({ question, why }: { question: string; why: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <div style={bubble(false)}>
        <span className="sr-only">Lookout: </span>
        {question}
        {why && (
          <>
            {" "}
            <InfoIcon tip={why} label="Why this question?" followScroll />
          </>
        )}
      </div>
    </div>
  );
}

/** Skip and Send: 44px tap targets, so they work by touch. */
const composerBtn: React.CSSProperties = { width: 44, height: 44, flex: "none", padding: 0, border: 0, borderRadius: 999, background: "transparent", color: color.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

/**
 * One bordered box: the answer, then a row with Skip and Send, the way a chat composer looks. Enter sends and
 * Shift+Enter makes a new line; on a touch keyboard Return makes a new line, and the Send button sends.
 */
export function Composer({ id, boxRef, value, onChange, onSend, onSkip, busy, placeholder = "Say it the way you'd tell a friend. Numbers help." }: {
  id: string;
  boxRef?: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSkip: () => void;
  busy: null | "answer" | "skip";
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const ready = !busy && !!value.trim();
  return (
    <>
      <label htmlFor={id} className="sr-only">Your answer</label>
      <div
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.target === e.currentTarget && boxRef?.current?.focus()}
        style={{ border: `1.5px solid ${focused ? color.ink : color.border}`, borderRadius: 14, background: "#fff", padding: "4px 6px 6px", display: "flex", flexDirection: "column", cursor: "text" }}
      >
        <textarea
          id={id}
          ref={boxRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (!(e.metaKey || e.ctrlKey) && window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            if (value.trim()) onSend();
          }}
          rows={3}
          maxLength={4000}
          disabled={!!busy}
          placeholder={placeholder}
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 8px 4px", border: 0, outline: "none", fontSize: font.lg, lineHeight: 1.5, resize: "none", color: color.ink, background: "transparent" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {/* Lookout's thinking shows in the chat, not here (#1449). */}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onSkip} disabled={!!busy} aria-label="Skip this question" data-tip="Skip this question" className="h-soft" style={composerBtn}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 5l9 7-9 7z" />
              <path d="M18 5v14" />
            </svg>
          </button>
          <button type="button" onClick={onSend} disabled={!ready} aria-label="Send" data-tip="Send" style={{ ...composerBtn, cursor: ready ? "pointer" : "default" }}>
            <span style={{ width: 34, height: 34, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: ready ? color.brick : color.border, color: "#fff", transition: "background .15s" }}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" />
                <path d="M6 11l6-6 6 6" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
