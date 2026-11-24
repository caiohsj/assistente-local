import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../services/api.js";
import {
  LocalAudioRecorder,
  isLocalCaptureSupported,
} from "../services/localAudio.js";
import {
  createRecognizer,
  isSpeechSupported,
  speechErrorMessage,
} from "../services/speech.js";

const END_FALLBACK_MS = 1000;

/**
 * Uma sessão de captura (fala → texto).
 *
 * Dois motores, escolhidos automaticamente:
 *  - Web Speech API, quando o navegador/WebView a oferece;
 *  - gravação local + /transcribe (faster-whisper), quando não oferece —
 *    é o caso do WebView WebKitGTK do Tauri no Linux.
 *
 * `onSettled` avisa quando o microfone foi realmente liberado; é o sinal usado
 * para rearmar a wake word sem deixar dois reconhecedores/gravações ativos.
 */
export function useVoiceCapture({
  enabled = false,
  language = "pt-BR",
  onTranscript,
  onError,
  onSettled,
} = {}) {
  const [status, setStatus] = useState(() =>
    isSpeechSupported() || isLocalCaptureSupported() ? "idle" : "unsupported"
  );
  const [transcript, setTranscript] = useState("");

  const engineRef = useRef(null); // "speech" | "local"
  const startingRef = useRef(false); // trava síncrona antes de qualquer await
  const recognizerRef = useRef(null);
  const localRecorderRef = useRef(null);
  const finalChunksRef = useRef([]);
  const sentRef = useRef(false);
  const fallbackTimerRef = useRef(null);
  const callbacksRef = useRef({ onTranscript, onError, onSettled });
  const configRef = useRef({ enabled, language });

  useEffect(() => {
    callbacksRef.current = { onTranscript, onError, onSettled };
  }, [onTranscript, onError, onSettled]);

  useEffect(() => {
    configRef.current = { enabled, language };
  }, [enabled, language]);

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  /** Libera o microfone do motor Web Speech, uma única vez por sessão. */
  const finish = useCallback(
    (recognizer) => {
      if (recognizerRef.current !== recognizer) return;
      clearFallback();
      recognizerRef.current = null;
      engineRef.current = null;
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      try {
        recognizer.stop?.();
      } catch {
        // Já encerrado.
      }
      setStatus((current) =>
        current === "error" || current === "unsupported" ? current : "idle"
      );
      callbacksRef.current.onSettled?.();
    },
    [clearFallback]
  );

  /** Encerramento silencioso (unmount) não deve transcrever nem rearmar. */
  const dispose = useCallback(() => {
    clearFallback();
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (recognizer) {
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      try {
        recognizer.stop?.();
      } catch {
        // Já encerrado.
      }
    }
    const recorder = localRecorderRef.current;
    localRecorderRef.current = null;
    if (recorder) void recorder.cancel(); // track.stop() é síncrono em release()
    engineRef.current = null;
  }, [clearFallback]);

  const stop = useCallback(async () => {
    if (engineRef.current === "local") {
      const recorder = localRecorderRef.current;
      localRecorderRef.current = null;
      engineRef.current = null;
      if (!recorder) return;
      setStatus("transcribing");
      try {
        const blob = await recorder.stop();
        const data = await transcribeAudio(blob);
        const text = String(data?.text ?? "").trim();
        setTranscript(text);
        if (text && !sentRef.current) {
          sentRef.current = true;
          callbacksRef.current.onTranscript?.(text);
        }
      } catch (error) {
        setStatus("error");
        callbacksRef.current.onError?.(
          error?.detail || "Não foi possível transcrever o áudio."
        );
      } finally {
        setStatus((current) => (current === "error" ? current : "idle"));
        callbacksRef.current.onSettled?.();
      }
      return;
    }

    const recognizer = recognizerRef.current;
    if (!recognizer) return;
    clearFallback();
    fallbackTimerRef.current = setTimeout(() => finish(recognizer), END_FALLBACK_MS);
    try {
      recognizer.stop();
    } catch {
      finish(recognizer);
    }
  }, [clearFallback, finish]);

  const start = useCallback(async () => {
    // Trava síncrona: getUserMedia demora e um segundo evento (atalho duplo,
    // wake + atalho) não pode abrir um segundo gravador antes do await.
    if (
      startingRef.current ||
      !configRef.current.enabled ||
      recognizerRef.current ||
      localRecorderRef.current
    ) {
      return false;
    }
    startingRef.current = true;
    try {
      finalChunksRef.current = [];
      sentRef.current = false;
      setTranscript("");

      const recognizer = createRecognizer({
        language: configRef.current.language,
        continuous: false,
        interimResults: true,
      });

      if (recognizer) {
        recognizer.onresult = (event) => {
          const results = Array.from(event.results ?? []);
          const finalChunks = [];
          let interim = "";
          for (let index = event.resultIndex ?? 0; index < results.length; index += 1) {
            const result = results[index];
            const text = result?.[0]?.transcript ?? "";
            if (result?.isFinal) finalChunks.push(text);
            else interim += text;
          }

          if (!finalChunks.length) {
            if (interim.trim()) setTranscript(interim.trim());
            return;
          }

          finalChunksRef.current.push(...finalChunks);
          const text = finalChunksRef.current.join(" ").replace(/\s+/g, " ").trim();
          setTranscript(text);
          if (text && !sentRef.current) {
            sentRef.current = true;
            stop();
            callbacksRef.current.onTranscript?.(text);
          }
        };
        recognizer.onerror = (event) => {
          const message = speechErrorMessage(event);
          if (!message) return;
          setStatus("error");
          callbacksRef.current.onError?.(message);
        };
        recognizer.onend = () => finish(recognizer);

        recognizerRef.current = recognizer;
        engineRef.current = "speech";
        setStatus("listening");
        try {
          recognizer.start();
        } catch {
          recognizerRef.current = null;
          engineRef.current = null;
          recognizer.onresult = null;
          recognizer.onerror = null;
          recognizer.onend = null;
          setStatus("error");
          callbacksRef.current.onError?.(
            "Não foi possível iniciar a captura de voz."
          );
          callbacksRef.current.onSettled?.();
          return false;
        }
        return true;
      }

      if (isLocalCaptureSupported()) {
        const recorder = new LocalAudioRecorder();
        try {
          // Refs atribuídas antes do await: a trava cobre a janela de permissão.
          localRecorderRef.current = recorder;
          engineRef.current = "local";
          await recorder.start();
          if (!configRef.current.enabled) {
            void recorder.cancel();
            localRecorderRef.current = null;
            engineRef.current = null;
            callbacksRef.current.onSettled?.();
            return false;
          }
        } catch {
          localRecorderRef.current = null;
          engineRef.current = null;
          void recorder.cancel();
          setStatus("error");
          callbacksRef.current.onError?.(
            "Não foi possível acessar o microfone. Verifique a permissão do aplicativo."
          );
          callbacksRef.current.onSettled?.();
          return false;
        }
        setStatus("listening");
        return true;
      }

      setStatus("unsupported");
      callbacksRef.current.onError?.(
        "Este navegador não oferece reconhecimento de voz."
      );
      callbacksRef.current.onSettled?.();
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [finish, stop]);

  const toggle = useCallback(() => {
    if (recognizerRef.current || localRecorderRef.current) {
      stop();
      return false;
    }
    return start();
  }, [start, stop]);

  useEffect(() => {
    if (!enabled && (recognizerRef.current || localRecorderRef.current)) stop();
    if (enabled && !isSpeechSupported() && !isLocalCaptureSupported()) {
      setStatus("unsupported");
    }
  }, [enabled, stop]);

  useEffect(() => () => dispose(), [dispose]);

  return {
    status,
    transcript,
    start,
    stop,
    toggle,
    supported: isSpeechSupported() || isLocalCaptureSupported(),
  };
}

export default useVoiceCapture;
