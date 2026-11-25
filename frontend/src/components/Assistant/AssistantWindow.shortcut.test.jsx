import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantWindow from "./AssistantWindow.jsx";

const state = vi.hoisted(() => ({
  eventHandler: null,
  capture: { status: "idle", starts: 0, stops: 0 },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event, handler) => {
    state.eventHandler = handler;
    return Promise.resolve(() => {
      state.eventHandler = null;
    });
  },
}));

vi.mock("../../hooks/useWindowControls.js", () => ({
  useWindowControls: () => ({
    isTauri: true,
    hide: () => {},
    show: () => {},
    toggle: () => {},
    startDragging: () => {},
    setAlwaysOnTop: () => {},
  }),
}));

vi.mock("../../hooks/useAssistant.js", () => ({
  useAssistant: () => ({
    messages: [],
    connection: "online",
    sending: false,
    error: null,
    lastToolCalls: [],
    voice: { enabled: true, language: "pt-BR", wake_word: "mestre" },
    sendMessage: () => Promise.resolve({ ok: true, clearInput: true, reply: "Pronto." }),
    clearError: () => {},
  }),
}));

vi.mock("../../hooks/useVoiceCapture.js", () => ({
  useVoiceCapture: () => ({
    status: state.capture.status,
    start: () => {
      state.capture.starts += 1;
      return Promise.resolve(true);
    },
    stop: () => {
      state.capture.stops += 1;
      return Promise.resolve();
    },
    toggle: () => {},
    supported: true,
  }),
}));

vi.mock("../../hooks/useWakeWord.js", () => ({
  useWakeWord: () => ({
    status: "idle",
    start: () => Promise.resolve(true),
    stop: () => {},
    pause: () => {},
    resume: () => {},
    supported: true,
  }),
}));

vi.mock("../../hooks/useSpeechPlayback.js", () => ({
  useSpeechPlayback: () => ({
    status: "idle",
    speaking: false,
    speak: () => Promise.resolve(true),
    stop: () => {},
  }),
}));

beforeEach(() => {
  vi.stubEnv("VITE_VOICE_ENABLED", "true");
  state.eventHandler = null;
  state.capture.status = "idle";
  state.capture.starts = 0;
  state.capture.stops = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AssistantWindow — atalho global", () => {
  it("o segundo aperto encerra a captura e envia o áudio", async () => {
    const { rerender } = render(<AssistantWindow />);
    await waitFor(() => expect(state.eventHandler).toBeTypeOf("function"));

    await act(async () => {
      await state.eventHandler();
    });
    expect(state.capture.starts).toBe(1);
    expect(state.capture.stops).toBe(0);

    // O hook reporta "ouvindo"; o mesmo atalho agora deve parar/transcrever.
    state.capture.status = "listening";
    rerender(<AssistantWindow />);
    await waitFor(() => expect(state.eventHandler).toBeTypeOf("function"));
    await act(async () => {
      await state.eventHandler();
    });

    expect(state.capture.stops).toBe(1);
    expect(state.capture.starts).toBe(1);
  });

  it("não reinicia a captura enquanto transcreve", async () => {
    const { rerender } = render(<AssistantWindow />);
    await waitFor(() => expect(state.eventHandler).toBeTypeOf("function"));

    state.capture.status = "transcribing";
    rerender(<AssistantWindow />);
    await waitFor(() => expect(state.eventHandler).toBeTypeOf("function"));
    await act(async () => {
      await state.eventHandler();
    });

    expect(state.capture.starts).toBe(0);
    expect(state.capture.stops).toBe(0);
  });
});
