const CONNECTION_LABELS = {
  checking: "conectando",
  online: "online",
  offline: "offline",
};

export default function AssistantHeader({ state = "active", connection = "checking", onHide, onDragStart }) {
  // Arrastar pelo cabeçalho usa um comando próprio do Rust em vez do
  // data-tauri-drag-region, que exigiria liberar permissão de plugin na ACL.
  function handleMouseDown(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    onDragStart?.();
  }

  const connectionLabel = CONNECTION_LABELS[connection] ?? CONNECTION_LABELS.checking;

  return (
    <header
      className={`assistant-header assistant-header--${state}`}
      onMouseDown={handleMouseDown}
    >
      <div className="assistant-header__brand">
        <span className="assistant-header__mark" aria-hidden="true">✦</span>
        <span className="assistant-header__titles">
          <strong>Mestre</strong>
          <small>seu espaço pessoal</small>
        </span>
      </div>

      <span
        className={`assistant-header__live assistant-header__live--${connection}`}
        title={`Backend: ${connectionLabel}`}
      >
        <span className="assistant-header__live-dot" aria-hidden="true" />
        <span>{connectionLabel}</span>
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
