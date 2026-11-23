import { MESSAGE_MAX_LENGTH } from "../../services/api.js";

/**
 * Campo de texto e botão de envio ativos. O microfone permanece apenas visual:
 * captura de voz (STT) está fora do escopo desta etapa.
 */
export default function AssistantControls({
  value = "",
  onChange,
  onSend,
  sending = false,
  error,
  onClearError,
  onClearInput,
}) {
  const canSend = Boolean(value.trim()) && !sending;

  async function submit() {
    if (!canSend) return;
    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      if (onClearInput) onClearInput(value);
      else onChange?.("");
      onClearError?.();
    };

    // O hook aceita a mensagem (valida e mostra a bolha) antes de await;
    // o campo limpa nesse instante, sem esperar o backend responder.
    const result = await onSend?.(value, { onAccepted: clear });
    // Compatibilidade com onSend que só sinaliza a limpeza ao final.
    if (result?.clearInput) clear();
  }

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handleChange(event) {
    onChange?.(event.target.value);
    if (error) onClearError?.();
  }

  return (
    <div className="assistant-controls">
      <form
        className="assistant-controls__field"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          rows="1"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder="Escreva sua mensagem…"
          aria-label="Campo de mensagem"
        />
        <button
          type="button"
          className="assistant-controls__mic"
          disabled
          title="Captura de voz em breve"
          aria-label="Microfone (em breve)"
        >
          <span aria-hidden="true">✦</span>
        </button>
        <button
          type="submit"
          className="assistant-controls__send"
          disabled={!canSend}
          title="Enviar mensagem"
          aria-label="Enviar mensagem"
        >
          <span aria-hidden="true">↑</span>
        </button>
      </form>
      <p
        className={`assistant-controls__hint${error ? " assistant-controls__hint--error" : ""}`}
        role={error ? "alert" : undefined}
      >
        {error || "Enter envia · Shift+Enter quebra linha"}
      </p>
    </div>
  );
}
