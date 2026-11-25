import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakText } from "../services/api.js";
import { useSpeechPlayback } from "./useSpeechPlayback.js";

vi.mock("../services/api.js", () => ({ speakText: vi.fn() }));

beforeEach(() => {
  speakText.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:wav"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSpeechPlayback", () => {
  it("não chama o backend com TTS desligado", async () => {
    const { result } = renderHook(() => useSpeechPlayback({ enabled: false }));
    let started;
    await act(async () => {
      started = await result.current.speak("oi");
    });
    expect(started).toBe(false);
    expect(speakText).not.toHaveBeenCalled();
  });

  it("busca o WAV, toca e interrompe", async () => {
    speakText.mockResolvedValue(new Blob(["wav"], { type: "audio/wav" }));
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSpeechPlayback({ enabled: true, onStart, onEnd, onError })
    );

    let started;
    await act(async () => {
      started = await result.current.speak("oi");
    });
    expect(started).toBe(true);
    expect(speakText).toHaveBeenCalledWith(
      "oi",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result.current.status).toBe("speaking");
    expect(result.current.speaking).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);

    act(() => result.current.stop());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
    expect(onError).not.toHaveBeenCalled();
  });

  it("mostra o detalhe do erro do backend", async () => {
    const error = new Error("falha");
    error.detail = "Não foi possível obter a resposta falada.";
    speakText.mockRejectedValue(error);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSpeechPlayback({ enabled: true, onError })
    );

    await act(async () => {
      await result.current.speak("oi");
    });
    expect(onError).toHaveBeenCalledWith("Não foi possível obter a resposta falada.");
    expect(result.current.status).toBe("idle");
  });

  it("stop() aborta a busca sem virar erro", async () => {
    speakText.mockImplementation(
      (_text, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("abort");
            error.name = "AbortError";
            reject(error);
          });
        })
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSpeechPlayback({ enabled: true, onError })
    );

    let pending;
    await act(async () => {
      pending = result.current.speak("oi");
    });
    await act(async () => {
      result.current.stop();
      await pending;
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});
