import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeWord } from "./useWakeWord.js";
import {
  finalResult,
  installSpeechRecognition,
  interimResult,
  resetSpeechRecognition,
} from "../test/speechMock.js";

let recognition;

beforeEach(() => {
  recognition = installSpeechRecognition();
});

afterEach(() => {
  resetSpeechRecognition();
  vi.useRealTimers();
});

describe("useWakeWord", () => {
  it("fica em escuta contínua quando habilitada", () => {
    const { result } = renderHook(() => useWakeWord({ enabled: true }));
    expect(result.current.status).toBe("listening");
    expect(recognition.instances).toHaveLength(1);
    expect(recognition.instances[0].continuous).toBe(true);
    expect(recognition.instances[0].interimResults).toBe(true);
  });

  it("detecta 'Mestre' em resultados intermitentes e só sinaliza uma vez", () => {
    const onWake = vi.fn();
    const { result } = renderHook(() =>
      useWakeWord({ enabled: true, onWake })
    );
    const recognizer = recognition.instances[0];

    act(() => recognizer.emitResult([interimResult("ei, mestre")]));
    act(() => recognizer.emitResult([interimResult("ei, mestre")]));

    expect(onWake).toHaveBeenCalledTimes(1);
    expect(recognizer.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("paused");
  });

  it("ignora frases sem a palavra de ativação", () => {
    const onWake = vi.fn();
    renderHook(() => useWakeWord({ enabled: true, onWake }));
    const recognizer = recognition.instances[0];

    act(() => recognizer.emitResult([finalResult("gerente, que horas são?")]));
    expect(onWake).not.toHaveBeenCalled();
  });

  it("usa a wake word configurada", () => {
    const onWake = vi.fn();
    renderHook(() =>
      useWakeWord({ enabled: true, wakeWord: "ok mestre", onWake })
    );
    act(() => recognition.instances[0].emitResult([finalResult("ok mestre")]));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("não reinicia após erro de permissão", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useWakeWord({ enabled: true, onError })
    );
    act(() => recognition.instances[0].emitError("not-allowed"));
    act(() => recognition.instances[0].emitEnd());
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.status).toBe("error");
    expect(recognition.instances).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
  });

  it("remonta o reconhecedor após um fim inesperado", () => {
    vi.useFakeTimers();
    renderHook(() => useWakeWord({ enabled: true }));
    const first = recognition.instances[0];

    act(() => first.emitEnd());
    act(() => vi.advanceTimersByTime(300));

    expect(recognition.instances).toHaveLength(2);
  });

  it("trata no-speech como recuperável e remonta a escuta", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useWakeWord({ enabled: true, onError })
    );
    const first = recognition.instances[0];

    act(() => first.emitError("no-speech"));
    act(() => first.emitEnd());
    act(() => vi.advanceTimersByTime(300));

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.status).toBe("listening");
    expect(recognition.instances).toHaveLength(2);
  });

  it("pausa para a captura e rearma só quando ela termina", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWakeWord({ enabled: true }));
    const first = recognition.instances[0];

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    act(() => vi.advanceTimersByTime(1000));
    expect(recognition.instances).toHaveLength(1);

    act(() => result.current.resume());
    expect(result.current.status).toBe("listening");
    expect(recognition.instances).toHaveLength(2);
    expect(first.stop).toHaveBeenCalled();
  });

  it("rearma depois de detectar a wake word quando a captura termina", () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    const { result } = renderHook(() => useWakeWord({ enabled: true, onWake }));

    act(() =>
      recognition.instances[0].emitResult([interimResult("ei, mestre")])
    );
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("paused");
    expect(recognition.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(recognition.instances).toHaveLength(1);

    act(() => result.current.resume());
    expect(result.current.status).toBe("listening");
    expect(recognition.instances).toHaveLength(2);
  });

  it("não escuta quando desabilitada", () => {
    const { result } = renderHook(() => useWakeWord({ enabled: false }));
    expect(result.current.status).toBe("off");
    expect(recognition.instances).toHaveLength(0);
  });
});
