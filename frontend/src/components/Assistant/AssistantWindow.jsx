import { useEffect, useState } from "react";
import AssistantHeader from "./AssistantHeader.jsx";
import AssistantMascot from "./AssistantMascot.jsx";
import AssistantStatus from "./AssistantStatus.jsx";
import AssistantControls from "./AssistantControls.jsx";
import { useWindowControls } from "../../hooks/useWindowControls.js";

export default function AssistantWindow() {
  const { hide, startDragging, isTauri } = useWindowControls();
  const [focused, setFocused] = useState(true);
  const [hovering, setHovering] = useState(false);

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

  return (
    <main className={`assistant-window assistant-window--${state}`}>
      <div className="assistant-window__wash" aria-hidden="true" />
      <AssistantHeader state={state} onHide={hide} onDragStart={startDragging} />

      <section className="assistant-stage">
        <AssistantMascot
          state={state}
          onEnter={() => setHovering(true)}
          onLeave={() => setHovering(false)}
        />
        <AssistantStatus mode={state} />
      </section>

      <AssistantControls />

      <footer className="assistant-footer">
        <span>MVP Desktop 0.4</span>
        <span className="assistant-footer__sep" aria-hidden="true" />
        <span>{isTauri ? "janela nativa" : "pré-visualização"}</span>
      </footer>
    </main>
  );
}
