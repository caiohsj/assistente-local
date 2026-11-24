import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  containsWakeWord,
  isRecoverableSpeechError,
  isSpeechSupported,
  normalizeText,
  speechErrorMessage,
} from "./speech.js";
import {
  installSpeechRecognition,
  resetSpeechRecognition,
} from "../test/speechMock.js";

beforeEach(() => {
  installSpeechRecognition();
});
afterEach(() => {
  resetSpeechRecognition();
});

describe("speech", () => {
  it("detecta suporte da Web Speech API", () => {
    expect(isSpeechSupported()).toBe(true);
    resetSpeechRecognition();
    expect(isSpeechSupported()).toBe(false);
  });

  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeText("  MÉSTRE, abra! ")).toBe("mestre abra");
    expect(normalizeText(null)).toBe("");
  });

  it("só dispara a wake word como palavra inteira", () => {
    expect(containsWakeWord("Ok, Mestre, abra a luz", "mestre")).toBe(true);
    expect(containsWakeWord("méstRE", "mestre")).toBe(true);
    expect(containsWakeWord("gerente da casa", "mestre")).toBe(false);
    expect(containsWakeWord("algo", "")).toBe(false);
  });

  it("traduz erros comuns para mensagens em português", () => {
    expect(speechErrorMessage({ error: "not-allowed" })).toMatch(/Permissão/);
    expect(speechErrorMessage({ error: "network" })).toMatch(/indisponível/);
    expect(speechErrorMessage({ error: "aborted" })).toBeNull();
    expect(speechErrorMessage({ error: "outro" })).toMatch(/capturar/);
  });

  it("classifica silêncio e aborto como erros recuperáveis", () => {
    expect(isRecoverableSpeechError({ error: "no-speech" })).toBe(true);
    expect(isRecoverableSpeechError("aborted")).toBe(true);
    expect(isRecoverableSpeechError({ error: "not-allowed" })).toBe(false);
  });
});
