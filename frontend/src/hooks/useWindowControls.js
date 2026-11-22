import { useCallback } from "react";

// No Tauri 2 o objeto __TAURI_INTERNALS__ existe apenas dentro da WebView.
// Fora dele (npm run dev no navegador) os comandos viram no-ops, permitindo
// continuar desenvolvendo a interface sem precisar compilar o Rust.
const isTauri =
  typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

async function command(name, args = {}) {
  if (!isTauri) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(name, args);
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[desktop] comando ${name} falhou:`, error);
    }
    return false;
  }
}

export function useWindowControls() {
  const hide = useCallback(() => command("window_hide"), []);
  const show = useCallback(() => command("window_show"), []);
  const toggle = useCallback(() => command("window_toggle"), []);
  const startDragging = useCallback(() => command("window_start_dragging"), []);
  const setAlwaysOnTop = useCallback(
    (enabled) => command("window_set_always_on_top", { enabled }),
    []
  );

  return { isTauri, hide, show, toggle, startDragging, setAlwaysOnTop };
}
