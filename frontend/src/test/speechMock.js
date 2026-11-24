import { vi } from "vitest";

export class MockSpeechRecognition {
  static instances = [];

  constructor() {
    this.lang = "";
    this.continuous = false;
    this.interimResults = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.start = vi.fn();
    // Navegadores disparam `end` quando stop() é chamado; o mock reproduce isso
    // para exercitar o caminho real de liberação do microfone.
    this.stop = vi.fn(() => {
      if (this.onend) this.onend();
    });
    MockSpeechRecognition.instances.push(this);
  }

  emitResult(results, resultIndex = 0) {
    this.onresult?.({ results, resultIndex });
  }

  emitError(error) {
    this.onerror?.({ error });
  }

  emitEnd() {
    this.onend?.();
  }
}

export function installSpeechRecognition() {
  window.SpeechRecognition = MockSpeechRecognition;
  return MockSpeechRecognition;
}

export function resetSpeechRecognition() {
  MockSpeechRecognition.instances.length = 0;
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
}

export function finalResult(text) {
  return { isFinal: true, 0: { transcript: text } };
}

export function interimResult(text) {
  return { isFinal: false, 0: { transcript: text } };
}
