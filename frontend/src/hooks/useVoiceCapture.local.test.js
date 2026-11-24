import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ gate: null, instances: [], failFirst: false }));

vi.mock("../services/localAudio.js", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRecorder {
    constructor() {
      state.instances.push(this);
    }
    async start() {
      if (state.gate) await state.gate;
      if (state.failFirst && state.instances.length === 1) {
        state.failFirst = false;
        throw new Error("microfone ocupado");
      }
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
import { isLocalCaptureSupported } from "../services/localAudio.js";
import { useVoiceCapture } from "./useVoiceCapture.js";
import { resetSpeechRecognition } from "../test/speechMock.js";

beforeEach(() => {
  resetSpeechRecognition(); // sem Web Speech API: caminho local
  vi.clearAllMocks();
  state.gate = null;
  state.failFirst = false;
  state.instances.length = 0;
  isLocalCaptureSupported.mockReturnValue(true);
  transcribeAudio.mockResolvedValue({ text: "abra a luz" });
});

afterEach(() => resetSpeechRecognition());

describe("useVoiceCapture com STT local", () => {
  it("grava, envia /transcribe e entrega o texto", async () => {
    const onTranscript = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onTranscript, onSettled })
    );

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });
    expect(result.current.status).toBe("listening");

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe("idle");
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("abra a luz");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("mostra erro do backend sem perder o estado de escuta", async () => {
    transcribeAudio.mockRejectedValue({ detail: "Falha ao transcrever o áudio." });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCapture({ enabled: true, onError })
    );

    await act(async () => {
      await result.current.start();
      await result.current.stop();
    });
    expect(result.current.status).toBe("error");
    expect(onError).toHaveBeenCalledWith("Falha ao transcrever o áudio.");
  });

  it("repeita getUserMedia após falha transitória ao trocar wake por captura", async () => {
    state.failFirst = true;
    const { result } = renderHook(() => useVoiceCapture({ enabled: true }));

    let started;
    await act(async () => {
      started = await result.current.start();
    });
    expect(started).toBe(true);
    expect(state.instances).toHaveLength(2);
    expect(result.current.status).toBe("listening");
  });

  it("não cria um segundo gravador enquanto o primeiro espera o microfone", async () => {
    let release;
    state.gate = new Promise((resolve) => {
      release = resolve;
    });
    const { result } = renderHook(() => useVoiceCapture({ enabled: true }));

    let first;
    let second;
    await act(async () => {
      first = result.current.start();
      second = result.current.start();
      release();
      await Promise.all([first, second]);
    });

    expect(state.instances).toHaveLength(1);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
  });
});
