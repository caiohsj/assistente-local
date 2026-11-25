/**
 * Respostas faladas: decisão, limpeza de Markdown e reprodução do WAV vindo
 * de POST /speak. Nenhum áudio é enviado a serviços externos.
 */

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu;

/** Texto falável: sem marcadores, links viram rótulo, código/URLs são descartados. */
export function plainText(markdown = "") {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(EMOJI, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Só fala o que é curto e simples: um parágrafo, até `maxChars` caracteres
 * visíveis e no máximo três frases. Markdown estruturado (listas, títulos,
 * tabelas, código) fica apenas na tela — ler isso em voz alta é ruim.
 */
export function isSimpleReply(reply, { maxChars = 240 } = {}) {
  const text = String(reply ?? "").trim();
  if (!text) return false;
  if (/```/.test(text)) return false;
  if (/^\s{0,3}#{1,6}\s/m.test(text)) return false;
  if (/^\s*\|.*\|\s*$/m.test(text)) return false;
  if (/^\s*(?:[-*+]|\d+\.)\s+/m.test(text)) return false;
  if (/(?:^|\n)\s*\n/.test(text)) return false;

  const spoken = plainText(text);
  if (!spoken || spoken.length > maxChars) return false;
  const sentences = spoken.split(/[.!?…]+/).map((part) => part.trim()).filter(Boolean);
  return sentences.length <= 3;
}

/** Devolve o texto para falar, ou `null` quando a resposta deve ficar só em texto. */
export function buildSpeech(reply, options = {}) {
  return isSimpleReply(reply, options) ? plainText(reply) : null;
}

/**
 * Reproduz um Blob WAV. injetar construtores mantém o módulo testável em Node
 * e evita depender de `URL.createObjectURL` durante os testes.
 */
export class SpeechPlayer {
  constructor({
    AudioCtor,
    createObjectURL,
    revokeObjectURL,
    onStart = () => {},
    onEnd = () => {},
    onError = () => {},
  } = {}) {
    this.AudioCtor = AudioCtor ?? globalThis.Audio ?? null;
    this.createObjectURL = createObjectURL ?? globalThis.URL?.createObjectURL?.bind(URL);
    this.revokeObjectURL = revokeObjectURL ?? globalThis.URL?.revokeObjectURL?.bind(URL);
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onError = onError;
    this.audio = null;
    this.url = null;
    this.generation = 0;
  }

  get playing() {
    return Boolean(this.audio);
  }

  _cleanup(notify) {
    const audio = this.audio;
    const url = this.url;
    this.audio = null;
    this.url = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // Já parado.
      }
    }
    if (url) {
      try {
        this.revokeObjectURL?.(url);
      } catch {
        // URL já liberada.
      }
    }
    if (notify && audio) this.onEnd();
  }

  stop() {
    this.generation += 1;
    this._cleanup(true);
  }

  async play(blob) {
    // Troca de faixa não conta como "fim" para a UI (evita piscar o status).
    this.generation += 1;
    this._cleanup(false);
    if (!blob || !this.AudioCtor || !this.createObjectURL) return false;

    const generation = this.generation;
    const url = this.createObjectURL(blob);
    const audio = new this.AudioCtor();
    audio.src = url;
    this.audio = audio;
    this.url = url;

    audio.onended = () => {
      if (generation !== this.generation) return;
      this._cleanup(true);
    };
    audio.onerror = () => {
      if (generation !== this.generation) return;
      this._cleanup(false);
      this.onError(new Error("Falha ao reproduzir o áudio."));
    };

    try {
      await audio.play();
      if (generation !== this.generation) return false;
      this.onStart();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this._cleanup(false);
      this.onError(error);
      return false;
    }
  }
}

export default SpeechPlayer;
