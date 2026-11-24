import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantWindow from "./AssistantWindow.jsx";
import { useAssistant } from "../../hooks/useAssistant.js";
import {
  installSpeechRecognition,
  resetSpeechRecognition,
} from "../../test/speechMock.js";

vi.mock("../../hooks/useAssistant.js", () => ({ useAssistant: vi.fn() }));

beforeEach(() => {
  installSpeechRecognition();
  useAssistant.mockReturnValue({
    messages: [],
    connection: "online",
    sending: false,
    error: null,
    lastToolCalls: [],
    voice: { enabled: true, wake_word: "mestre", language: "pt-BR" },
    sendMessage: vi.fn(),
    clearError: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSpeechRecognition();
});

describe("AssistantWindow", () => {
  it("mantém o microfone desabilitado sem VITE_VOICE_ENABLED", () => {
    vi.stubEnv("VITE_VOICE_ENABLED", "false");
    render(<AssistantWindow />);
    expect(
      screen.getByRole("button", { name: "Microfone desabilitado" })
    ).toBeDisabled();
    expect(
      screen.queryByRole("group", { name: "Modo de ativação por voz" })
    ).toBeNull();
  });

  it("mantém o microfone desabilitado sem VOICE_ENABLED no backend", () => {
    vi.stubEnv("VITE_VOICE_ENABLED", "true");
    useAssistant.mockReturnValue({
      messages: [],
      connection: "online",
      sending: false,
      error: null,
      lastToolCalls: [],
      voice: { enabled: false },
      sendMessage: vi.fn(),
      clearError: vi.fn(),
    });
    render(<AssistantWindow />);
    expect(
      screen.getByRole("button", { name: "Microfone desabilitado" })
    ).toBeDisabled();
  });

  it("habilita microfone e modos quando as duas válvulas estão ligadas", () => {
    vi.stubEnv("VITE_VOICE_ENABLED", "true");
    render(<AssistantWindow />);
    expect(
      screen.getByRole("button", { name: "Iniciar captura de voz" })
    ).toBeEnabled();
    expect(
      screen.getByRole("group", { name: "Modo de ativação por voz" })
    ).toBeInTheDocument();
  });
});
