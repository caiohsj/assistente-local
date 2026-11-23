const LABELS = {
  // Estados visuais originais.
  idle: { title: "Em espera", hint: "Assistente local · sem serviços em nuvem" },
  hover: { title: "Interação detectada", hint: "Assistente local · sem serviços em nuvem" },
  active: { title: "Disponível", hint: "Assistente local · sem serviços em nuvem" },
  // Estados de conexão e de conversa.
  connecting: { title: "Conectando…", hint: "Consultando o backend local" },
  online: { title: "Conectado", hint: "Backend local · FastAPI" },
  offline: { title: "Backend indisponível", hint: "Inicie o backend em 127.0.0.1:8765" },
  thinking: { title: "Pensando…", hint: "Consultando o modelo local" },
  error: { title: "Falha ao consultar o modelo", hint: "Verifique a mensagem acima" },
};

const VISUAL_MODES = new Set(["idle", "hover", "active"]);

export default function AssistantStatus({ mode = "idle" }) {
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
