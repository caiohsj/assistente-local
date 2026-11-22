/**
 * Controles puramente visuais. Nenhum processamento de mensagem, áudio ou
 * rede acontece aqui — estes elementos preparam a interface para etapas
 * futuras de conversa e captura de voz.
 */
export default function AssistantControls() {
  return (
    <div className="assistant-controls">
      <div className="assistant-controls__field">
        <textarea
          rows="1"
          disabled
          placeholder="Conversa disponível em breve…"
          aria-label="Campo de mensagem (funcionalidade futura)"
        />
        <button
          type="button"
          disabled
          title="Captura de voz em breve"
          aria-label="Microfone (funcionalidade futura)"
        >
          <span aria-hidden="true">✦</span>
        </button>
        <button
          type="button"
          disabled
          title="Envio em breve"
          aria-label="Enviar mensagem (funcionalidade futura)"
        >
          <span aria-hidden="true">↑</span>
        </button>
      </div>
      <p className="assistant-controls__hint">
        Voz e conversa serão ativadas em uma próxima etapa.
      </p>
    </div>
  );
}
