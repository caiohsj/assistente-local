import { MESSAGE_MAX_LENGTH } from "../../services/api.js";

const MIC_LABELS = {
  idle: "Iniciar captura de voz",
  listening: "Parar captura de voz",
  transcribing: "Transcrevendo áudio…",
  unsupported: "Microfone não suportado neste navegador",
  error: "Microfone com erro — toque para tentar de novo",
};

/**
 * Campo de texto, botão de envio e controles de voz. O microfone só aparece
 * como ativo quando a variável de ambiente habilita o recurso no frontend e
 * no backend; fora isso ele permanece desabilitado (modo texto intacto).
 */
export default function AssistantControls({
  value = "",
  onChange,
  onSend,
  sending = false,
  error,
  onClearError,
  onClearInput,
  voiceEnabled = false,
  voiceStatus = "idle",
  voiceError = null,
  voiceMode = "shortcut",
  wakeWord = "mestre",
  onVoiceModeChange,
  onVoiceToggle,
}) {
  const canSend = Boolean(value.trim()) && !sending;
  const micDisabled = !voiceEnabled || sending || voiceStatus === "transcribing";

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

  const hint = error
    ? error
    : voiceError
      ? voiceError
      : voiceStatus === "listening"
        ? "Ouvindo… fale sua mensagem"
        : voiceStatus === "transcribing"
          ? "Transcrevendo sua fala…"
          : "Enter envia · Shift+Enter quebra linha";

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
          className={`assistant-controls__mic${voiceStatus === "listening" ? " assistant-controls__mic--listening" : ""}${voiceStatus === "transcribing" ? " assistant-controls__mic--busy" : ""}`}
          disabled={micDisabled}
          onClick={onVoiceToggle}
          title={
            voiceEnabled
              ? MIC_LABELS[voiceStatus] ?? MIC_LABELS.idle
              : "Captura de voz desabilitada (VOICE_ENABLED / VITE_VOICE_ENABLED)"
          }
          aria-label={
            voiceEnabled
              ? MIC_LABELS[voiceStatus] ?? MIC_LABELS.idle
              : "Microfone desabilitado"
          }
        >
          <span aria-hidden="true">{voiceStatus === "listening" ? "■" : "✦"}</span>
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

      {voiceEnabled && (
        <div
          className="assistant-controls__voice-modes"
          role="group"
          aria-label="Modo de ativação por voz"
        >
          <span>Ativar</span>
          <button
            type="button"
            aria-pressed={voiceMode === "shortcut"}
            onClick={() => onVoiceModeChange?.("shortcut")}
          >
            atalho
          </button>
          <button
            type="button"
            aria-pressed={voiceMode === "wake"}
            onClick={() => onVoiceModeChange?.("wake")}
          >
            dizer “{wakeWord}”
          </button>
        </div>
      )}

      <p
        className={`assistant-controls__hint${error || voiceError ? " assistant-controls__hint--error" : ""}`}
        role={error || voiceError ? "alert" : undefined}
      >
        {hint}
      </p>
    </div>
  );
}
