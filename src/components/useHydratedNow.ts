"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};
let loadedAt: number | null = null;

/**
 * The time, or null while the page hydrates (#1531). The server renders in UTC and the browser in local time, so text
 * that depends on today ("1d ago", the new dot) must wait for the browser, or React throws hydration error 418.
 */
export const useHydratedNow = (): number | null => useSyncExternalStore(never, () => (loadedAt ??= Date.now()), () => null);
