import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../services/api.js";
import {
  LocalAudioRecorder,
  isLocalCaptureSupported,
} from "../services/localAudio.js";
import {
  containsWakeWord,
  createRecognizer,
  isRecoverableSpeechError,
  isSpeechSupported,
  speechErrorMessage,
} from "../services/speech.js";

const RESTART_DELAY_MS = 300;
const COOLDOWN_MS = 2000;
const LOCAL_WINDOW_MS = 3500;
const DEBUG = import.meta.env.DEV && import.meta.env.MODE !== "test";

/**
 * Escuta contínua da palavra de ativação ("Mestre").
 *
 * Com Web Speech API usa reconhecimento contínuo. Sem ela (Tauri/WebKitGTK),
 * grava janelas curtas de áudio e manda transcrever no backend, verificando a
 * palavra de ativação no texto. Em ambos os casos nada do que é dito vai para
 * o chat — a detecção só sinaliza `onWake`.
 *
 * `pause()` libera o microfone para uma captura em andamento e `resume()`
 * rearma a escuta quando ela termina: nunca dois consumidores de áudio ativos.
 */
export function useWakeWord({
  enabled = false,
  language = "pt-BR",
  wakeWord = "mestre",
  onWake,
  onError,
} = {}) {
  const [status, setStatus] = useState("off"); // off | listening | paused | error | unsupported
  const recognizerRef = useRef(null);
  const localRecorderRef = useRef(null);
  const localTimerRef = useRef(null);
  const localBusyRef = useRef(false);
  const armingRef = useRef(false); // trava síncrona antes do await de getUserMedia
  const generationRef = useRef(0); // invalida arms pendentes após pause/stop
  const pendingResumeRef = useRef(false);
  const engineRef = useRef(null); // "speech" | "local"
  const mountedRef = useRef(true);
  const enabledRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const lastWakeRef = useRef(0);
  const restartTimerRef = useRef(null);
  const armRef = useRef(null);
  const armLocalRef = useRef(null);
  const localWindowRef = useRef(null);
  const callbacksRef = useRef({ onWake, onError });
  const configRef = useRef({ language, wakeWord });

  useEffect(() => {
    callbacksRef.current = { onWake, onError };
  }, [onWake, onError]);

  useEffect(() => {
    configRef.current = { language, wakeWord };
  }, [language, wakeWord]);

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearLocalTimer = useCallback(() => {
    if (localTimerRef.current !== null) {
      clearInterval(localTimerRef.current);
      localTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    generationRef.current += 1; // qualquer arm em voo deixa de ser válido
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
    clearLocalTimer();
    localBusyRef.current = false;
    const recorder = localRecorderRef.current;
    localRecorderRef.current = null;
    if (recorder) void recorder.cancel(); // track.stop() é síncrono em release()
    engineRef.current = null;
  }, [clearLocalTimer]);

  const arm = useCallback(() => {
    if (!mountedRef.current || !enabledRef.current || stopRequestedRef.current) return;
    if (recognizerRef.current) return;

    const recognizer = createRecognizer({
      language: configRef.current.language,
      continuous: true,
      interimResults: true,
    });
    if (!recognizer) return;

    recognizer.onresult = (event) => {
      const heard = Array.from(event.results ?? [])
        .map((result) => result?.[0]?.transcript ?? "")
        .join(" ");
      const now = Date.now();
      if (
        containsWakeWord(heard, configRef.current.wakeWord) &&
        now - lastWakeRef.current > COOLDOWN_MS
      ) {
        lastWakeRef.current = now;
        stopRequestedRef.current = true;
        clearRestart();
        cleanup();
        setStatus("paused");
        callbacksRef.current.onWake?.();
      }
    };

    recognizer.onerror = (event) => {
      if (isRecoverableSpeechError(event)) return;
      const message = speechErrorMessage(event);
      if (!message) return;
      stopRequestedRef.current = true;
      setStatus("error");
      callbacksRef.current.onError?.(message);
    };

    recognizer.onend = () => {
      if (recognizerRef.current !== recognizer) return;
      recognizerRef.current = null;
      if (
        mountedRef.current &&
        enabledRef.current &&
        !stopRequestedRef.current &&
        restartTimerRef.current === null
      ) {
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          armRef.current?.();
        }, RESTART_DELAY_MS);
      }
    };

    recognizerRef.current = recognizer;
    engineRef.current = "speech";
    setStatus("listening");
    try {
      recognizer.start();
    } catch {
      recognizerRef.current = null;
      stopRequestedRef.current = true;
      setStatus("error");
      callbacksRef.current.onError?.(
        "Não foi possível iniciar a escuta da wake word."
      );
    }
  }, [cleanup, clearRestart]);
  armRef.current = arm;

  /** Transcreve uma janela curta e decide se houve ativação. */
  const runLocalWindow = useCallback(async () => {
    if (
      !mountedRef.current ||
      !enabledRef.current ||
      stopRequestedRef.current ||
      localBusyRef.current
    ) {
      return;
    }
    const recorder = localRecorderRef.current;
    // drain() NÃO encerra a gravação: o microfone fica aberto durante o STT.
    const blob = recorder?.drain?.();
    if (!blob) return;
    localBusyRef.current = true;
    try {
      const data = await transcribeAudio(blob);
      // A transcrição pode levar até 180 s: revalida antes de agir.
      if (!mountedRef.current || !enabledRef.current || stopRequestedRef.current) {
        return;
      }
      const text = String(data?.text ?? "").trim();
      if (DEBUG && text) console.debug("[voz] wake ouviu:", text);
      const now = Date.now();
      if (
        containsWakeWord(text, configRef.current.wakeWord) &&
        now - lastWakeRef.current > COOLDOWN_MS
      ) {
        lastWakeRef.current = now;
        stopRequestedRef.current = true;
        engineRef.current = null;
        clearLocalTimer();
        localRecorderRef.current = null;
        void recorder.cancel();
        setStatus("paused");
        if (DEBUG) console.debug("[voz] wake detectada, iniciando captura");
        callbacksRef.current.onWake?.();
      }
    } catch (error) {
      if (DEBUG) console.warn("[voz] falha no STT da wake word:", error);
      // Falha transitória do STT: descarta a janela e tenta a próxima.
    } finally {
      localBusyRef.current = false;
    }
  }, [clearLocalTimer]);
  localWindowRef.current = runLocalWindow;

  const armLocal = useCallback(async () => {
    if (armingRef.current || !mountedRef.current || !enabledRef.current || stopRequestedRef.current) return;
    if (localRecorderRef.current || localBusyRef.current) return;
    armingRef.current = true;
    const generation = generationRef.current;
    try {
      const recorder = new LocalAudioRecorder();
      // A ref entra antes do await: duas chamadas a resume() não podem criar
      // dois gravadores enquanto a permissão está sendo concedida.
      localRecorderRef.current = recorder;
      try {
        await recorder.start();
      } catch {
        localRecorderRef.current = null;
        void recorder.cancel();
        stopRequestedRef.current = true;
        setStatus("error");
        callbacksRef.current.onError?.(
          "Não foi possível acessar o microfone para a wake word."
        );
        return;
      }
      if (
        generation !== generationRef.current ||
        !mountedRef.current ||
        !enabledRef.current ||
        stopRequestedRef.current
      ) {
        void recorder.cancel();
        if (localRecorderRef.current === recorder) localRecorderRef.current = null;
        return;
      }
      engineRef.current = "local";
      setStatus("listening");
      clearLocalTimer();
      // Intervalo fixo: transcreve janelas enquanto a gravação continua,
      // sem deixar o microfone parado durante o STT.
      localTimerRef.current = setInterval(() => {
        localWindowRef.current?.();
      }, LOCAL_WINDOW_MS);
    } finally {
      armingRef.current = false;
      if (
        pendingResumeRef.current &&
        mountedRef.current &&
        enabledRef.current &&
        !stopRequestedRef.current &&
        !engineRef.current
      ) {
        pendingResumeRef.current = false;
        armLocalRef.current?.();
      }
    }
  }, [clearLocalTimer]);
  armLocalRef.current = armLocal;

  /** Libera o microfone para a captura, mantendo o modo wake ativo. */
  const pause = useCallback(() => {
    stopRequestedRef.current = true;
    clearRestart();
    cleanup();
    setStatus("paused");
  }, [cleanup, clearRestart]);

  /** Reativa a escuta após a captura terminar. */
  const resume = useCallback(() => {
    if (!enabledRef.current || !mountedRef.current) return false;
    if (armingRef.current) {
      // O arm em voo vai ser invalidado pelo cleanup; rearmamos no finally dele.
      stopRequestedRef.current = false;
      pendingResumeRef.current = true;
      return true;
    }
    stopRequestedRef.current = false;
    if (engineRef.current) return true;
    setStatus("listening");
    if (isSpeechSupported()) arm();
    else if (isLocalCaptureSupported()) armLocal();
    else setStatus("unsupported");
    return true;
  }, [arm, armLocal]);

  /** Desliga o modo wake (troca de modo ou unmount). */
  const stop = useCallback(() => {
    enabledRef.current = false;
    stopRequestedRef.current = true;
    clearRestart();
    cleanup();
    setStatus("off");
  }, [cleanup, clearRestart]);

  const start = useCallback(() => {
    enabledRef.current = true;
    stopRequestedRef.current = false;
    if (!isSpeechSupported() && !isLocalCaptureSupported()) {
      setStatus("unsupported");
      return false;
    }
    setStatus("listening");
    if (isSpeechSupported()) arm();
    else armLocal();
    return true;
  }, [arm, armLocal]);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return () => {
      enabledRef.current = false;
      stopRequestedRef.current = true;
      clearRestart();
      cleanup();
    };
  }, [enabled, start, stop, clearRestart, cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { status, start, stop, pause, resume, supported: isSpeechSupported() || isLocalCaptureSupported() };
}

export default useWakeWord;
