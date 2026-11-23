import { useEffect, useState } from "react";
import AssistantHeader from "./AssistantHeader.jsx";
import AssistantMascot from "./AssistantMascot.jsx";
import AssistantStatus from "./AssistantStatus.jsx";
import AssistantControls from "./AssistantControls.jsx";
import AssistantConversation from "./AssistantConversation.jsx";
import { useAssistant } from "../../hooks/useAssistant.js";
import { useWindowControls } from "../../hooks/useWindowControls.js";

export default function AssistantWindow() {
  const { hide, startDragging, isTauri } = useWindowControls();
  const {
    messages,
    connection,
    sending,
    error,
    lastToolCalls,
    sendMessage,
    clearError,
  } = useAssistant();
  const [focused, setFocused] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // hover > active (janela aberta e focada) > idle (aguardando, sem foco)
  const state = hovering ? "hover" : focused ? "active" : "idle";
  const hasConversation = messages.length > 0;

  // Estado visual e estado de conexão são independentes: o badge do cabeçalho
  // não pode dizer "online" só porque a janela está focada.
  const statusMode = sending
    ? "thinking"
    : connection === "offline"
      ? "offline"
      : error
        ? "error"
        : connection === "checking"
          ? "connecting"
          : state;

  const mascot = (
    <AssistantMascot
      state={state}
      onEnter={() => setHovering(true)}
      onLeave={() => setHovering(false)}
    />
  );
  const status = <AssistantStatus mode={statusMode} />;

  return (
    <main className={`assistant-window assistant-window--${state}`}>
      <div className="assistant-window__wash" aria-hidden="true" />
      <AssistantHeader
        state={state}
        connection={connection}
        onHide={hide}
        onDragStart={startDragging}
      />

      {hasConversation ? (
        <>
          <div className="assistant-stage assistant-stage--compact">{mascot}</div>
          <div className="assistant-status-bar">{status}</div>
          <AssistantConversation
            messages={messages}
            toolCalls={lastToolCalls}
            sending={sending}
          />
        </>
      ) : (
        <section className="assistant-stage">
          {mascot}
          {status}
        </section>
      )}

      <AssistantControls
        value={draft}
        onChange={setDraft}
        onSend={sendMessage}
        onClearInput={(sent) =>
          setDraft((current) => (current === sent ? "" : current))
        }
        sending={sending}
        error={error}
        onClearError={clearError}
      />

      <footer className="assistant-footer">
        <span>MVP Desktop 0.4</span>
        <span className="assistant-footer__sep" aria-hidden="true" />
        <span>{isTauri ? "janela nativa" : "pré-visualização"}</span>
      </footer>
    </main>
  );
}
