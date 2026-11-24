import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceCapture } from "./useVoiceCapture.js";
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
});

describe("useVoiceCapture", () => {
  it("não inicia quando o recurso está desabilitado", async () => {
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: false, onTranscript: vi.fn() })
    );
    await act(async () => {
      await result.current.start();
    });
    expect(recognition.instances).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("configura o reconhecedor com o idioma e entrega o resultado final uma vez", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, language: "pt-BR", onTranscript })
    );

    let started;
    await act(async () => {
      started = await result.current.start();
    });
    expect(started).toBe(true);
    expect(result.current.status).toBe("listening");

    const recognizer = recognition.instances[0];
    expect(recognizer.lang).toBe("pt-BR");
    expect(recognizer.continuous).toBe(false);

    act(() => {
      recognizer.emitResult([interimResult("ligar a")]);
    });
    expect(result.current.transcript).toBe("ligar a");
    expect(onTranscript).not.toHaveBeenCalled();

    act(() => {
      recognizer.emitResult([finalResult("ligar a luz")]);
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("ligar a luz"));
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
    expect(recognizer.stop).toHaveBeenCalled();
  });

  it("junta vários resultados finais do mesmo evento e não reenvia depois", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onTranscript })
    );
    await act(async () => {
      await result.current.start();
    });
    const recognizer = recognition.instances[0];

    act(() =>
      recognizer.emitResult([finalResult("uma "), finalResult("duas")])
    );
    expect(onTranscript).toHaveBeenCalledWith("uma duas");

    act(() => recognizer.emitResult([finalResult("tardia")]));
    expect(onTranscript).toHaveBeenCalledTimes(1);
  });

  it("exibe erro de permissão sem lançar exceção", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onError })
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => recognition.instances[0].emitError("not-allowed"));

    expect(result.current.status).toBe("error");
    expect(onError.mock.calls[0][0]).toMatch(/Permissão/);
  });

  it("para a captura ao desabilitar", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useVoiceCapture({ enabled }),
      { initialProps: { enabled: true } }
    );
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("listening");

    await act(async () => {
      rerender({ enabled: false });
    });
    expect(result.current.status).toBe("idle");
    expect(recognition.instances[0].stop).toHaveBeenCalled();
  });

  it("avisa quando o microfone foi liberado para rearmar a wake word", async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onSettled })
    );
    await act(async () => {
      await result.current.start();
    });
    expect(onSettled).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop();
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  });

  it("não sinaliza liberação ao desmontar", async () => {
    const onSettled = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVoiceCapture({ enabled: true, onSettled })
    );
    await act(async () => {
      await result.current.start();
    });
    unmount();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("sinaliza navegador sem suporte", async () => {
    resetSpeechRecognition();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onError })
    );
    expect(result.current.status).toBe("unsupported");
    await act(async () => {
      await result.current.start();
    });
    expect(onError).toHaveBeenCalled();
  });
});
