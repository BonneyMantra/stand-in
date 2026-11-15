import { lazy, type ComponentType } from "react";

const KEY = "standin:chunk-reload";

/**
 * React.lazy for a page section that reloads the page once when its chunk is gone. A deploy replaces the hashed chunks, so
 * a tab opened before it asks for a file that no longer exists; a reload fetches the new build. A second failure within
 * 30 s is thrown to the section's error boundary instead of looping.
 */
export function lazyWithReload<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy<ComponentType<P>>(() =>
    load().catch((e: unknown) => {
      let recent = false;
      try {
        recent = Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000;
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        // storage blocked: reload anyway, once per page
      }
      if (recent) throw e;
      window.location.reload();
      return new Promise<never>(() => {});
    }),
  );
}
