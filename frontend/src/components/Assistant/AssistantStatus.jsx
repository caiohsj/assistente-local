const LABELS = {
  idle: "Em espera",
  hover: "Interação detectada",
  active: "Disponível"
};

export default function AssistantStatus({ mode = "idle" }) {
  return (
    <div className={`assistant-status assistant-status--${mode}`} role="status" aria-live="polite">
      <span className="assistant-status__beacon" aria-hidden="true">
        <span className="assistant-status__ring" />
        <span className="assistant-status__dot" />
      </span>
      <span className="assistant-status__copy">
        <strong>{LABELS[mode] ?? LABELS.idle}</strong>
        <small>Assistente local · sem serviços em nuvem</small>
      </span>
    </div>
  );
}
