import { useCallback, useEffect, useRef, useState } from "react";
import AssistantHeader from "./AssistantHeader.jsx";
import AssistantMascot from "./AssistantMascot.jsx";
import AssistantStatus from "./AssistantStatus.jsx";
import AssistantControls from "./AssistantControls.jsx";
import AssistantConversation from "./AssistantConversation.jsx";
import { useAssistant } from "../../hooks/useAssistant.js";
import { useVoiceCapture } from "../../hooks/useVoiceCapture.js";
import { useWakeWord } from "../../hooks/useWakeWord.js";
import { useWindowControls } from "../../hooks/useWindowControls.js";

const VOICE_REQUEST_EVENT = "mestre://voice-request";

export default function AssistantWindow() {
  const { hide, startDragging, isTauri } = useWindowControls();
  const {
    messages,
    connection,
    sending,
    error,
    lastToolCalls,
    voice,
    sendMessage,
    clearError,
  } = useAssistant();
  const [focused, setFocused] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [draft, setDraft] = useState("");
  // Por privacidade o modo wake nunca é restaurado automaticamente: cada
  // sessão começa no atalho e o usuário escolhe a escuta contínua de novo.
  const [voiceMode, setVoiceMode] = useState("shortcut");
  const [voiceError, setVoiceError] = useState(null);

  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;
  const wakeRef = useRef(null);
  const captureStatusRef = useRef(null);
  const startingCaptureRef = useRef(false);

  // A válvula é dupla: o build do frontend e o backend têm que habilitar voz.
  const frontendVoiceEnabled = import.meta.env.VITE_VOICE_ENABLED === "true";
  const voiceEnabled = frontendVoiceEnabled && voice?.enabled === true;
  const language = voice?.language || import.meta.env.VITE_VOICE_LANGUAGE || "pt-BR";
  const wakeWord = voice?.wake_word || "mestre";

  const handleTranscript = useCallback(
    async (text) => {
      setVoiceError(null);
      const result = await sendMessage(text);
      if (result?.error) setVoiceError(result.error);
    },
    [sendMessage]
  );
  const handleVoiceError = useCallback((message) => setVoiceError(message), []);
  const handleCaptureSettled = useCallback(() => {
    if (voiceMode === "wake") wakeRef.current?.resume();
  }, [voiceMode]);

  const capture = useVoiceCapture({
    enabled: voiceEnabled,
    language,
    onTranscript: handleTranscript,
    onError: handleVoiceError,
    onSettled: handleCaptureSettled,
  });
  captureStatusRef.current = capture.status;

  // Um único reconhecedor por documento: a wake word pausa antes de qualquer
  // captura e só rearma depois que o microfone foi liberado (onSettled).
  const startCapture = useCallback(async () => {
    if (startingCaptureRef.current) return false;
    if (sendingRef.current) {
      // Nenhuma captura foi iniciada, então não haverá onSettled: a wake word
      // precisa ser devolvida explicitamente se foi ela que disparou.
      if (voiceModeRef.current === "wake") wakeRef.current?.resume();
      return false;
    }
    if (
      captureStatusRef.current === "listening" ||
      captureStatusRef.current === "transcribing"
    ) {
      return false;
    }
    startingCaptureRef.current = true;
    try {
      wakeRef.current?.pause();
      setVoiceError(null);
      // Fonte única de rearm: useVoiceCapture chama onSettled em todo fim de
      // sessão (inclusive falha), então resume() não deve ser chamado aqui.
      return await capture.start();
    } finally {
      startingCaptureRef.current = false;
    }
  }, [capture.start]);

  const handleVoiceToggle = useCallback(async () => {
    if (captureStatusRef.current === "listening") {
      await capture.stop(); // onSettled rearma a wake word, se estiver ativa
      return;
    }
    await startCapture();
  }, [capture.stop, startCapture]);

  const wake = useWakeWord({
    enabled: voiceEnabled && voiceMode === "wake",
    language,
    wakeWord,
    onWake: startCapture,
    onError: handleVoiceError,
  });
  wakeRef.current = wake;

  const changeVoiceMode = useCallback((mode) => {
    setVoiceMode(mode);
    setVoiceError(null);
  }, []);

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

  // Atalho global do Rust (e item "Falar com Mestre" da bandeja): abrir a
  // janela e começar a ouvir, independentemente do modo wake word escolhido.
  useEffect(() => {
    if (!isTauri || !voiceEnabled) return undefined;
    let unlisten;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unlisten = await listen(VOICE_REQUEST_EVENT, startCapture);
      } catch (voiceEventError) {
        if (import.meta.env.DEV) {
          console.warn("[voz] falha ao escutar atalho:", voiceEventError);
        }
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isTauri, voiceEnabled, startCapture]);

  // hover > ouvindo > ativo (janela aberta e focada) > idle
  const state = hovering ? "hover" : focused ? "active" : "idle";
  const hasConversation = messages.length > 0;
  const listening = capture.status === "listening";

  // Estado visual e estado de conexão são independentes: o badge do cabeçalho
  // não pode dizer "online" só porque a janela está focada.
  const statusMode = sending
    ? "thinking"
    : listening
      ? "listening"
      : capture.status === "transcribing"
        ? "transcribing"
        : wake.status === "listening"
          ? "wake"
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
  const status = (
    <AssistantStatus mode={statusMode} voiceEnabled={voiceEnabled} />
  );

  return (
    <main
      className={`assistant-window assistant-window--${state}${listening ? " assistant-window--listening" : ""}`}
    >
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
        voiceEnabled={voiceEnabled}
        voiceStatus={capture.status}
        voiceError={voiceError}
        voiceMode={voiceMode}
        wakeWord={wakeWord}
        onVoiceModeChange={changeVoiceMode}
        onVoiceToggle={handleVoiceToggle}
      />

      <footer className="assistant-footer">
        <span>MVP Desktop 0.4</span>
        <span className="assistant-footer__sep" aria-hidden="true" />
        <span>{isTauri ? "janela nativa" : "pré-visualização"}</span>
      </footer>
    </main>
  );
}
