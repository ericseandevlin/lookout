"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus (#212): while the dialog is open, Tab and Shift+Tab stay inside it; when it closes,
 * focus goes back to whatever had it before. If the dialog doesn't move focus in itself (autoFocus
 * or a ref), the first focusable element gets it. Escape stays with each dialog.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const box = ref.current;
    // Let the dialog's own autoFocus or focus() run first.
    const t = setTimeout(() => {
      if (box && !box.contains(document.activeElement)) box.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !box) return;
      const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      if (back?.isConnected) back.focus();
    };
  }, [ref]);
}
