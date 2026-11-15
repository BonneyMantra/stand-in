/**
 * A tab opened before a deploy asks for hashed chunks the new deploy no longer serves, and the route went blank (seen on
 * /app/owner). Vite announces a failed dynamic import or preload with `vite:preloadError`; this reloads the page once to get
 * the new build, and if the chunk still fails right after that reload, leaves the page as it is and shows a reload notice.
 */

// Shared with lib/lab/lazyPage.ts, so a lab section and this handler see the same recent reload.
const KEY = "standin:chunk-reload";
const WINDOW_MS = 30_000;

/** True when a reload already happened for a failed chunk moments ago (or, with storage blocked, this load was a reload). */
function reloadedRecently(): boolean {
  try {
    const recent = Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < WINDOW_MS;
    sessionStorage.setItem(KEY, String(Date.now()));
    return recent;
  } catch {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "reload";
  }
}

function showReloadNotice() {
  if (document.getElementById("standin-reload-notice")) return;
  const box = document.createElement("div");
  box.id = "standin-reload-notice";
  box.setAttribute("role", "alert");
  box.className = "fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-[10px] border border-warn/30 bg-ink-900 px-4 py-3 text-[13px] text-fg shadow-lg";
  const text = document.createElement("p");
  text.className = "min-w-0 flex-1";
  text.textContent = "Stand-in was updated while this tab was open, and part of this page could not load.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "h-8 shrink-0 rounded-md bg-fg px-3 text-xs font-medium text-ink-950";
  button.textContent = "Reload the page";
  button.addEventListener("click", () => window.location.reload());
  box.append(text, button);
  document.body.append(box);
}

export function installStaleChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadedRecently()) {
      showReloadNotice();
      return; // the error reaches the route's boundary, which also offers a reload
    }
    event.preventDefault();
    window.location.reload();
  });
}
