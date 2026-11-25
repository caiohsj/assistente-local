import { useCallback, useEffect, useRef, useState } from "react";
import { speakText } from "../services/api.js";
import { SpeechPlayer } from "../services/tts.js";

/**
 * Reproduz a resposta falada do backend. `status` é compartilhado com a janela
 * para pausar a wake word enquanto o assistente fala (e evitar que ele ouça a
 * própria voz). `stop()` é seguro em qualquer estado: aborta o fetch e a faixa.
 */
export function useSpeechPlayback({ enabled = false, onStart, onEnd, onError } = {}) {
  const [status, setStatus] = useState("idle");
  const controllerRef = useRef(null);
  const generationRef = useRef(0);
  const enabledRef = useRef(enabled);
  const callbacksRef = useRef({ onStart, onEnd, onError });

  useEffect(() => {
    callbacksRef.current = { onStart, onEnd, onError };
  }, [onStart, onEnd, onError]);

  const playerRef = useRef(null);
  if (playerRef.current === null) {
    playerRef.current = new SpeechPlayer({
      onStart: () => {
        setStatus("speaking");
        callbacksRef.current.onStart?.();
      },
      onEnd: () => {
        setStatus("idle");
        callbacksRef.current.onEnd?.();
      },
      onError: (error) => {
        setStatus("idle");
        callbacksRef.current.onError?.(
          error?.message || "Não foi possível reproduzir a resposta falada."
        );
      },
    });
  }

  const stop = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    playerRef.current.stop();
    setStatus("idle");
  }, []);

  const speak = useCallback(
    async (text) => {
      if (!enabledRef.current || !String(text ?? "").trim()) return false;
      stop();
      const generation = generationRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("loading");

      try {
        const blob = await speakText(String(text).trim(), { signal: controller.signal });
        if (generation !== generationRef.current || !enabledRef.current) return false;
        return await playerRef.current.play(blob);
      } catch (error) {
        if (generation !== generationRef.current || error?.name === "AbortError") {
          return false;
        }
        setStatus("idle");
        callbacksRef.current.onError?.(
          error?.detail || "Não foi possível obter a resposta falada."
        );
        return false;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [stop]
  );

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    status,
    speaking: status === "speaking" || status === "loading",
    speak,
    stop,
  };
}

export default useSpeechPlayback;
