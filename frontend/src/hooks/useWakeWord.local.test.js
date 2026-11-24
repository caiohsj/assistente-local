import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ gate: null }));

vi.mock("../services/localAudio.js", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRecorder {
    static instances = [];
    constructor() {
      FakeRecorder.instances.push(this);
    }
    async start() {
      if (state.gate) await state.gate;
      return this;
    }
    async stop() {
      return new Blob(["wav"], { type: "audio/wav" });
    }
    async cancel() {}
  }
  return {
    ...actual,
    LocalAudioRecorder: FakeRecorder,
    isLocalCaptureSupported: vi.fn(() => true),
  };
});

vi.mock("../services/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, transcribeAudio: vi.fn() };
});

import { transcribeAudio } from "../services/api.js";
import { LocalAudioRecorder, isLocalCaptureSupported } from "../services/localAudio.js";
import { useWakeWord } from "./useWakeWord.js";
import { resetSpeechRecognition } from "../test/speechMock.js";

beforeEach(() => {
  resetSpeechRecognition();
  vi.clearAllMocks();
  state.gate = null;
  isLocalCaptureSupported.mockReturnValue(true);
  transcribeAudio.mockResolvedValue({ text: "nada importante" });
  LocalAudioRecorder.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetSpeechRecognition();
});

describe("useWakeWord com STT local", () => {
  it("transcreve janelas e dispara ao ouvir a palavra de ativação", async () => {
    transcribeAudio.mockResolvedValue({ text: "ei, mestre" });
    const onWake = vi.fn();
    const { result } = renderHook(() => useWakeWord({ enabled: true, onWake }));

    await act(async () => {});
    expect(result.current.status).toBe("listening");
    expect(LocalAudioRecorder.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("paused");

    // A captura chama resume() quando termina: a escuta local deve rearmar.
    await act(async () => {
      result.current.resume();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("listening");
    expect(LocalAudioRecorder.instances).toHaveLength(2);
  });

  it("continua gravando novas janelas quando não há ativação", async () => {
    const { result } = renderHook(() => useWakeWord({ enabled: true }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(result.current.status).toBe("listening");
    expect(LocalAudioRecorder.instances).toHaveLength(2);
  });

  it("rearma depois de pausar para a captura", async () => {
    const { result } = renderHook(() => useWakeWord({ enabled: true }));
    await act(async () => {});

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(LocalAudioRecorder.instances).toHaveLength(1);

    await act(async () => {
      result.current.resume();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("listening");
    expect(LocalAudioRecorder.instances).toHaveLength(2);
  });

  it("não cria dois gravadores se resume() for chamado durante o await", async () => {
    let release;
    state.gate = new Promise((resolve) => {
      release = resolve;
    });
    const { result } = renderHook(() => useWakeWord({ enabled: true }));
    await act(async () => {});

    act(() => result.current.pause());
    await act(async () => {
      result.current.resume();
      result.current.resume();
      release();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(LocalAudioRecorder.instances).toHaveLength(2); // 1 inicial + 1 rearmado
    expect(result.current.status).toBe("listening");
  });

  it("ignora detecção que chega depois de desabilitada", async () => {
    transcribeAudio.mockResolvedValue({ text: "mestre" });
    const onWake = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useWakeWord({ enabled, onWake }),
      { initialProps: { enabled: true } }
    );
    await act(async () => {});

    act(() => rerender({ enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(onWake).not.toHaveBeenCalled();
    expect(result.current.status).toBe("off");
  });
});
