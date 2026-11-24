import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * Last data each view received, kept in memory while the app is open. Going back to a module shows what it had
 * at once, while fresh data loads in the background (instead of an empty page waiting for the API again).
 * Cleared on a full page reload or sign-out (memory only, nothing written to the browser).
 */
const viewCache = new Map<string, unknown>();

export function clearViewCache() {
  viewCache.clear();
}

/** useState that remembers its last value across leaving and coming back to a page (same `key`). */
export function useCachedState<T>(key: string): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(() => (viewCache.get(key) as T | undefined) ?? null);
  const set = useCallback((v: T) => {
    viewCache.set(key, v);
    setValue(v);
  }, [key]);
  return [value, set];
}

/**
 * Loads data and refreshes it every `intervalMs` while the tab is visible.
 * - Shows the last data this view had (same page, same request) straight away, then refreshes it.
 * - A tick is skipped while the previous request is still running, so slow replies never pile up.
 * - When the reply is identical to the last one the state is left alone, so big tables do not re-render.
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs = 3000, deps: unknown[] = []) {
  // Same request on the same page = same cache entry (the page path is part of the key, so a value captured
  // from the URL, such as a task id, never shows another page's data)
  const key = `${window.location.pathname}${window.location.search}|${load.toString()}|${safeJson(deps)}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [data, setData] = useState<T | null>(() => (viewCache.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const inFlight = useRef(false);
  const lastJson = useRef<string | null>(null);
  const generation = useRef(0);

  const apply = useCallback((next: T, gen: number) => {
    if (gen !== generation.current) return; // a reply for old parameters (deps changed meanwhile)
    viewCache.set(keyRef.current, next);
    let json: string | null = null;
    try { json = JSON.stringify(next); } catch { /* not serialisable: always update */ }
    if (json !== null && json === lastJson.current) return;
    lastJson.current = json;
    setData(next);
  }, []);

  /** Manual refresh (after an action): always runs. */
  const refresh = useCallback(async () => {
    const gen = generation.current;
    try {
      apply(await loadRef.current(), gen);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apply]);

  /** Timer tick: skipped while a request is still running. */
  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await refresh();
    } finally {
      inFlight.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    // new parameters: show what we had for them last time (if anything) while they load
    const cached = viewCache.get(keyRef.current) as T | undefined;
    if (cached !== undefined) {
      lastJson.current = safeJson(cached);
      setData(cached);
    }
    tick();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, intervalMs);
    // coming back to the tab: refresh at once instead of waiting for the next tick
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, intervalMs, ...deps]);

  return { data, error, refresh };
}

function safeJson(v: unknown): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}

/** Runs an async action with a busy flag and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/**
 * A piece of page state kept in the URL (?key=value), so a reload shows the same view and the browser's
 * Back button returns to the previous view.
 *  - `push: true`  for navigation (opening a detail, switching a section): each change is a Back step.
 *  - `push: false` (default) for filters and searches: the URL updates in place, without extra Back steps.
 * The default value is left out of the URL to keep it clean.
 */
export function useUrlState<T extends string>(
  key: string,
  initial: T,
  { push = false }: { push?: boolean } = {},
): [T, (value: T) => void, () => void] {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const value = (params.get(key) ?? initial) as T;
  const set = useCallback(
    (next: T) => {
      // Read the live URL (not the render-time params) so several setters in one click all apply
      const p = new URLSearchParams(window.location.search);
      if (next === initial || next === "" || next == null) p.delete(key);
      else p.set(key, String(next));
      const search = p.toString();
      if (search === window.location.search.replace(/^\?/, "")) return;
      navigate(
        { pathname: window.location.pathname, search: search ? `?${search}` : "", hash: window.location.hash },
        // Mark entries this page pushed, so back() knows the previous entry is this page's earlier view
        { replace: !push, state: push ? { urlStateFrom: key } : window.history.state?.usr ?? null },
      );
    },
    [key, initial, push, navigate],
  );
  /** In-page "Back": one history step when this view was opened from the page, else reset to the default view. */
  const back = useCallback(() => {
    if ((location.state as { urlStateFrom?: string } | null)?.urlStateFrom === key) navigate(-1);
    else set(initial);
  }, [location.state, key, navigate, set, initial]);
  return [value, set, back];
}

/** One step back in the browser history; when the page was opened directly (reload / new tab) go to `fallback`. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
