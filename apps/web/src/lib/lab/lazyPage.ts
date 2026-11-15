import { lazy, type ComponentType } from "react";
import { holdIfCancelled } from "../staleChunk";

const KEY = "standin:chunk-reload";

/**
 * React.lazy for a page section that reloads the page once when its chunk is gone. A deploy replaces the hashed chunks, so
 * a tab opened before it asks for a file that no longer exists; a reload fetches the new build. A second failure within
 * 30 s is thrown to the section's error boundary instead of looping. When the app's global handler (lib/staleChunk.ts)
 * reloads first, it cancels the import, which then resolves to nothing: holdIfCancelled keeps the fallback up until the
 * reload instead of a "Cannot read properties of undefined (reading 'default')" render error.
 */
export function lazyWithReload<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy<ComponentType<P>>(holdIfCancelled(() =>
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
  ));
}
