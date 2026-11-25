import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantWindow from "./AssistantWindow.jsx";

const state = vi.hoisted(() => ({
  send: { calls: [], result: null },
  speech: { status: "idle", speakCalls: [], stopCalls: 0, callbacks: {} },
  capture: { status: "idle", onTranscript: null },
  wake: { status: "idle", pauses: 0, resumes: 0 },
}));

vi.mock("../../hooks/useAssistant.js", () => ({
  useAssistant: () => ({
    messages: [],
    connection: "online",
    sending: false,
    error: null,
    lastToolCalls: [],
    voice: {
      enabled: true,
      wake_word: "mestre",
      language: "pt-BR",
      tts_enabled: true,
      tts_available: true,
      tts_max_chars: 240,
    },
    sendMessage: (text, options) => {
      state.send.calls.push([text, options]);
      return Promise.resolve(state.send.result);
    },
    clearError: () => {},
  }),
}));

vi.mock("../../hooks/useSpeechPlayback.js", () => ({
  useSpeechPlayback: (callbacks) => {
    state.speech.callbacks = callbacks;
    return {
      status: state.speech.status,
      speaking: state.speech.status !== "idle",
      speak: (text) => {
        state.speech.speakCalls.push(text);
        return Promise.resolve(true);
      },
      stop: () => {
        state.speech.stopCalls += 1;
      },
    };
  },
}));

vi.mock("../../hooks/useVoiceCapture.js", () => ({
  useVoiceCapture: ({ onTranscript }) => {
    state.capture.onTranscript = onTranscript;
    return {
      status: state.capture.status,
      start: () => Promise.resolve(true),
      stop: () => Promise.resolve(),
      toggle: () => {},
      supported: true,
    };
  },
}));

vi.mock("../../hooks/useWakeWord.js", () => ({
  useWakeWord: () => ({
    status: state.wake.status,
    pause: () => {
      state.wake.pauses += 1;
    },
    resume: () => {
      state.wake.resumes += 1;
    },
    start: () => Promise.resolve(true),
    stop: () => {},
  }),
}));

beforeEach(() => {
  vi.stubEnv("VITE_VOICE_ENABLED", "true");
  state.send.calls = [];
  state.send.result = { ok: true, clearInput: true, reply: "Pronto." };
  state.speech.status = "idle";
  state.speech.speakCalls = [];
  state.speech.stopCalls = 0;
  state.speech.callbacks = {};
  state.capture.status = "idle";
  state.capture.onTranscript = null;
  state.wake.status = "idle";
  state.wake.pauses = 0;
  state.wake.resumes = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AssistantWindow — resposta falada", () => {
  it("fala respostas curtas vindas de voz", async () => {
    render(<AssistantWindow />);
    await act(async () => {
      await state.capture.onTranscript("oi");
    });
    expect(state.send.calls).toEqual([["oi", { source: "voice" }]]);
    expect(state.speech.speakCalls).toEqual(["Pronto."]);
  });

  it("não fala respostas com Markdown estruturado", async () => {
    state.send.result = {
      ok: true,
      clearInput: true,
      reply: "**Pronto**\n\n1. abra o terminal\n2. digite `htop`",
    };
    render(<AssistantWindow />);
    await act(async () => {
      await state.capture.onTranscript("oi");
    });
    expect(state.speech.speakCalls).toEqual([]);
  });

  it("não fala resposta a texto digitado", async () => {
    render(<AssistantWindow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "oi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    });
    expect(state.send.calls[0][1]).toMatchObject({ source: "text" });
    expect(state.speech.speakCalls).toEqual([]);
  });

  it("mostra o estado e permite interromper a fala", () => {
    state.speech.status = "speaking";
    render(<AssistantWindow />);
    expect(screen.getByText("Falando…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parar resposta falada" }));
    expect(state.speech.stopCalls).toBe(1);
  });

  it("pausa e retoma a wake word em volta da fala", () => {
    render(<AssistantWindow />);
    fireEvent.click(screen.getByRole("button", { name: /dizer/ }));
    act(() => state.speech.callbacks.onStart());
    expect(state.wake.pauses).toBe(1);
    act(() => state.speech.callbacks.onEnd());
    expect(state.wake.resumes).toBe(1);
  });
});
