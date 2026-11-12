"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import s from "./landing.module.css";

/**
 * Motion for the landing page (#600). A Playable block plays its clip while hovered (mouse) or while
 * mostly in view (touch). With reduced motion nothing plays: the poster frame stays.
 */
const Playing = createContext(false);

export function Playable({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const start = () => setOn(true);
      const stop = () => setOn(false);
      el.addEventListener("mouseenter", start);
      el.addEventListener("mouseleave", stop);
      return () => {
        el.removeEventListener("mouseenter", start);
        el.removeEventListener("mouseleave", stop);
      };
    }
    const io = new IntersectionObserver(([e]) => setOn(e.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Playing.Provider value={on}>
      <div ref={ref} className={className} data-on={on || undefined}>
        {children}
      </div>
    </Playing.Provider>
  );
}

/** A short screen recording of the real app (demo account, made-up companies). Starts over each time it plays. */
export function Clip({ src, poster, label }: { src: string; poster: string; label: string }) {
  const on = useContext(Playing);
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (on) {
      el.currentTime = 0;
      el.play().catch(() => {});
    } else el.pause();
  }, [on]);
  return (
    <div className={s.clip} role="img" aria-label={label}>
      <video ref={v} src={src} muted loop playsInline preload="metadata" aria-hidden tabIndex={-1} />
      {/* eslint-disable-next-line @next/next/no-img-element -- the poster sits over the video and fades out while it plays */}
      <img src={poster} alt="" className={s.poster} data-hide={on || undefined} />
      <span className={s.playHint} data-hide={on || undefined} aria-hidden>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
        Hover to play
      </span>
    </div>
  );
}

const QUESTIONS: { q: string; opts: string[]; pick: number[] }[] = [
  { q: "What's the next role, and what would make it a real step up?", opts: ["Bigger title", "Larger team", "Own the strategy", "More pay"], pick: [1, 2] },
  { q: "What comp would you walk away from, and what would make you jump?", opts: ["Floor $140,000", "Would jump for $175,000"], pick: [0, 1] },
  { q: "Where and how do you want to work?", opts: ["On-site", "Hybrid", "Remote"], pick: [1] },
  { q: "What's the win you'd lead with in an interview?", opts: ["Grew revenue", "Cut costs", "Built a team", "Turned it around"], pick: [0] },
  { q: "What's off the table?", opts: ["Relocating", "Lots of travel", "Agencies", "Nights and weekends"], pick: [0, 3] },
];

/** Step 1: the five questions, one at a time, the way the setup asks them. */
export function FiveQuestions() {
  const on = useContext(Playing);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setI((n) => (n + 1) % QUESTIONS.length), 2200);
    return () => {
      clearInterval(t);
      setI(0);
    };
  }, [on]);
  const cur = on ? i : 0;
  const q = QUESTIONS[cur];
  return (
    <div className={s.qs} role="img" aria-label="The five setup questions, one at a time.">
      <div className={s.qBar}>
        <span style={{ width: `${((cur + 1) / 5) * 100}%` }} />
      </div>
      <div className={s.qCount}>{cur + 1} of 5</div>
      <div key={on ? `q${i}` : "still"} className={s.qSlide} data-anim={on || undefined}>
        <div className={s.qN}>0{cur + 1}</div>
        <div className={s.qQ}>{q.q}</div>
        <div className={s.qOpts}>
          {q.opts.map((o, k) => (
            <span key={o} className={s.qOpt} data-pick={q.pick.includes(k) || undefined} style={{ animationDelay: `${0.12 + k * 0.08}s` }}>
              {q.pick.includes(k) && <b aria-hidden>✓ </b>}
              {o}
            </span>
          ))}
        </div>
      </div>
      <span className={s.playHint} data-hide={on || undefined} aria-hidden>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
        Hover to play
      </span>
    </div>
  );
}

/** The product video under the hero: plays muted while in view; one button turns the sound on. */
export function ProductVideo() {
  const v = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.controls = true; // no autoplay; the viewer starts it
      return;
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? el.play().catch(() => {}) : el.pause()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={s.product}>
      <video
        ref={v}
        src="/landing/product.mp4"
        poster="/landing/product.jpg"
        muted={muted}
        loop
        playsInline
        preload="metadata"
        aria-label="An 18-second tour: the board fills with finds, a find opens with its reasons, and an application is drafted and approved."
      />
      <button type="button" className={s.sound} onClick={() => setMuted((m) => !m)} aria-pressed={!muted}>
        {muted ? "Sound on" : "Sound off"}
      </button>
    </div>
  );
}
