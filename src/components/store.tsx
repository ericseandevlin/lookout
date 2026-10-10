"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Answers, AppState, Find, Link, RunInfo, Settings } from "@/lib/types";

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    window.location.replace(window.location.origin);
    throw new Error("Signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Something went wrong");
  return data as T;
}

type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
};

function useStoreValue(initial: AppState) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    const next = await api<AppState>("/api/state");
    setState(next);
    return next;
  }, []);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Something went wrong");
    setTimeout(() => setError(null), 4000);
  }, []);

  // While a search runs, poll its progress quickly (cheap) and reload the board when it ends.
  const runActive = !!state.running;
  useEffect(() => {
    if (!runActive) return;
    const t = setInterval(async () => {
      try {
        const { run } = await api<{ run: RunInfo | null }>("/api/runs/latest");
        const active = run && (run.status === "running" || run.status === "queued");
        if (active) setState((s) => ({ ...s, run }));
        else await refresh();
      } catch {
        // keep polling
      }
    }, 1500);
    return () => clearInterval(t);
  }, [runActive, refresh]);

  // Resume scans: slower poll on the full state.
  const scanning = state.materials.resume?.status === "scanning";
  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [scanning, refresh]);

  const patchFind = useCallback(
    (id: string, patch: Partial<Pick<Find, "pinned" | "archived" | "stage" | "notes">> & { seen?: true }) => {
      setState((s) => ({
        ...s,
        finds: s.finds.map((f) => (f.id === id ? { ...f, ...patch, seen: true } : f)),
      }));
      return api(`/api/finds/${id}`, { method: "PATCH", json: patch }).catch(fail);
    },
    [fail],
  );

  const putSettings = useCallback(
    (patch: Partial<Settings>) => {
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      return api("/api/settings", { method: "PATCH", json: patch }).catch(fail);
    },
    [fail],
  );

  const setName = useCallback(
    (name: string) => {
      setState((s) => ({ ...s, user: { ...s.user, name } }));
      return api("/api/me", { method: "PATCH", json: { name } }).catch(fail);
    },
    [fail],
  );

  const pendingAnswers = useRef<Answers>({});
  const pendingClear = useRef<string[]>([]);
  const answerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flushAnswers = useCallback(
    async (save: boolean) => {
      clearTimeout(answerTimer.current);
      const pa = pendingAnswers, pc = pendingClear;
      const answers = pa.current;
      const clearAuto = pc.current;
      pa.current = {};
      pc.current = [];
      try {
        const r = await api<{ savedAt: string | null }>("/api/profile", { method: "PUT", json: { answers, clearAuto, save } });
        if (save) setState((s) => ({ ...s, profile: { ...s.profile, savedAt: r.savedAt } }));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  /** Local edit of profile answers. Editing a field clears its "Filled from" tag. */
  const editAnswers = useCallback((patch: Answers, clearAuto: string[]) => {
    setState((s) => {
      const auto = { ...s.profile.auto };
      clearAuto.forEach((k) => delete auto[k]);
      return { ...s, profile: { ...s.profile, answers: { ...s.profile.answers, ...patch }, auto } };
    });
    pendingAnswers.current = { ...pendingAnswers.current, ...patch };
    pendingClear.current = [...new Set([...pendingClear.current, ...clearAuto])];
    clearTimeout(answerTimer.current);
    answerTimer.current = setTimeout(() => flushAnswers(false), 800);
  }, [flushAnswers]);
  const materials = useMemo(
    () => ({
      async uploadResume(file: File) {
        const fd = new FormData();
        fd.append("file", file);
        setState((s) => ({
          ...s,
          materials: {
            ...s.materials,
            resume: { id: "pending", name: file.name, status: "scanning", uploadedAt: new Date().toISOString(), filled: "" },
          },
        }));
        try {
          await api("/api/materials/resume", { method: "POST", body: fd });
        } catch (e) {
          fail(e);
        }
        await refresh().catch(() => {});
      },
      async deleteResume() {
        setState((s) => ({ ...s, materials: { ...s.materials, resume: null } }));
        await api("/api/materials/resume", { method: "DELETE" }).catch(fail);
      },
      setLinkedin(handle: string) {
        setState((s) => ({ ...s, materials: { ...s.materials, linkedin: { ...s.materials.linkedin, handle, linked: false } } }));
        clearTimeout(liTimer.current);
        liTimer.current = setTimeout(() => api("/api/materials/linkedin", { method: "PUT", json: { handle } }).catch(fail), 600);
      },
      async scanLinkedin() {
        const handle = stateRef.current.materials.linkedin.handle.trim();
        if (!handle) return;
        clearTimeout(liTimer.current);
        setState((s) => ({ ...s, materials: { ...s.materials, linkedin: { ...s.materials.linkedin, handle, linked: true } } }));
        await api("/api/materials/linkedin", { method: "PUT", json: { handle, scan: true } }).catch(fail);
      },
      async uploadLinkedinPdf(file: File) {
        const fd = new FormData();
        fd.append("file", file);
        const { pdf } = await api<{ pdf: { name: string; uploadedAt: string } }>("/api/materials/linkedin/pdf", { method: "POST", body: fd });
        setState((s) => ({ ...s, materials: { ...s.materials, linkedin: { ...s.materials.linkedin, pdf } } }));
      },
      async deleteLinkedinPdf() {
        setState((s) => ({ ...s, materials: { ...s.materials, linkedin: { ...s.materials.linkedin, pdf: null } } }));
        await api("/api/materials/linkedin/pdf", { method: "DELETE" }).catch(fail);
      },
      async addLink(url: string) {
        try {
          const { link } = await api<{ link: Link }>("/api/materials/links", { method: "POST", json: { url } });
          setState((s) => ({ ...s, materials: { ...s.materials, links: [...s.materials.links, link] } }));
        } catch (e) {
          fail(e);
        }
      },
      async updateLink(id: string, patch: { url?: string; kind?: string | null }) {
        setState((s) => ({
          ...s,
          materials: { ...s.materials, links: s.materials.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
        }));
        await api(`/api/materials/links/${id}`, { method: "PATCH", json: patch }).catch(fail);
      },
      async removeLink(id: string) {
        setState((s) => ({ ...s, materials: { ...s.materials, links: s.materials.links.filter((l) => l.id !== id) } }));
        await api(`/api/materials/links/${id}`, { method: "DELETE" }).catch(fail);
      },
    }),
    [fail, refresh],
  );
  const liTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const startedRun = (trigger: string): RunInfo => ({
    id: "pending", trigger, status: "running", pct: 1, step: trigger === "url" ? "Opening the link" : "Starting the search",
    log: [], found: 0, added: 0, error: null, startedAt: new Date().toISOString(), finishedAt: null, report: null,
  });

  const addFindByUrl = useCallback(async (url: string) => {
    await api("/api/finds", { method: "POST", json: { url } });
    setState((s) => ({ ...s, running: "url", run: startedRun("url") }));
  }, []);

  const searchNow = useCallback(async () => {
    await api("/api/runs", { method: "POST" });
    setState((s) => ({ ...s, running: "manual", run: startedRun("manual") }));
  }, []);

  return {
    state,
    error,
    fail,
    refresh,
    patchFind,
    putSettings,
    setName,
    editAnswers,
    saveProfile: () => flushAnswers(true),
    materials,
    addFindByUrl,
    searchNow,
  };
}

export function StoreProvider({ initial, children }: { initial: AppState; children: React.ReactNode }) {
  const value = useStoreValue(initial);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
