const VISUAL_MODES = new Set(["idle", "hover", "active"]);

export default function AssistantStatus({ mode = "idle", voiceEnabled = false }) {
  // A Web Speech API pode enviar áudio ao provedor do navegador para transcrever.
  // Com voz desligada a afirmação "sem nuvem" continua válida; ligada, o texto
  // precisa ser honesto sobre o uso de rede.
  const baseHint = voiceEnabled
    ? "Mestre · transcrição pelo navegador (pode usar rede)"
    : "Mestre · conversa local, sem nuvem";

  const LABELS = {
    // Estados visuais originais.
    idle: { title: "Em espera", hint: baseHint },
    hover: { title: "Interação detectada", hint: baseHint },
    active: { title: "Disponível", hint: baseHint },
    // Estados de conexão e de conversa.
    connecting: { title: "Conectando…", hint: "Consultando o backend local" },
    online: { title: "Conectado", hint: "Backend local · FastAPI" },
    offline: { title: "Backend indisponível", hint: "Inicie o backend em 127.0.0.1:8765" },
    thinking: { title: "Pensando…", hint: "Consultando o modelo local" },
    transcribing: { title: "Transcrevendo…", hint: "Convertendo sua fala em texto" },
    listening: { title: "Ouvindo…", hint: "Fale sua mensagem para o Mestre" },
    error: { title: "Falha ao consultar o modelo", hint: "Verifique a mensagem acima" },
  };

  const label = LABELS[mode] ?? LABELS.idle;
  // Só anunciamos conexão/conversa: hover e foco são decorativos.
  const isLive = !VISUAL_MODES.has(mode);

  return (
    <div
      className={`assistant-status assistant-status--${mode}`}
      role={isLive ? "status" : undefined}
      aria-live={isLive ? "polite" : undefined}
    >
      <span className="assistant-status__beacon" aria-hidden="true">
        <span className="assistant-status__ring" />
        <span className="assistant-status__dot" />
      </span>
      <span className="assistant-status__copy">
        <strong>{label.title}</strong>
        <small>{label.hint}</small>
      </span>
    </div>
  );
}
