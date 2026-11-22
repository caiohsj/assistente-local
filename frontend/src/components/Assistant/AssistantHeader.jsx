export default function AssistantHeader({ state, onHide, onDragStart }) {
  // Arrastar pelo cabeçalho usa um comando próprio do Rust em vez do
  // data-tauri-drag-region, que exigiria liberar permissão de plugin na ACL.
  function handleMouseDown(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    onDragStart?.();
  }

  return (
    <header className="assistant-header" onMouseDown={handleMouseDown}>
      <div className="assistant-header__brand">
        <span className="assistant-header__mark" aria-hidden="true">✦</span>
        <span className="assistant-header__titles">
          <strong>Assistente Local</strong>
          <small>seu espaço pessoal</small>
        </span>
      </div>

      <span className={`assistant-header__live assistant-header__live--${state}`}>
        <span className="assistant-header__live-dot" aria-hidden="true" />
        <span>{state === "idle" ? "ocioso" : "online"}</span>
      </span>

      <div className="assistant-header__actions">
        <button
          type="button"
          className="window-button"
          onClick={onHide}
          title="Ocultar janela"
          aria-label="Ocultar janela"
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          className="window-button window-button--close"
          onClick={onHide}
          title="Fechar (a janela é ocultada, o aplicativo continua na bandeja)"
          aria-label="Fechar janela"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </header>
  );
}
