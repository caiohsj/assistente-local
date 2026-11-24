/**
 * Captura de áudio para ambientes sem Web Speech API (ex.: WebView WebKitGTK
 * do Tauri no Linux). Grava PCM via Web Audio e devolve um WAV mono para o
 * endpoint /transcribe. Nenhum áudio é enviado diretamente do navegador a
 * serviços externos.
 */

export function isLocalCaptureSupported() {
  return Boolean(
    typeof navigator !== "undefined" &&
      navigator.mediaDevices?.getUserMedia &&
      typeof window !== "undefined" &&
      (window.AudioContext || window.webkitAudioContext)
  );
}

/** Converte pedaços Float32 mono em um Blob WAV PCM 16 bits. */
export function encodeWav(chunks, sampleRate = 16000) {
  const frames = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);

  const writeString = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits por amostra
  writeString(36, "data");
  view.setUint32(40, frames * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// Teto de 30 s a 16 kHz: evita WAV maior que o limite do /transcribe.
const MAX_SAMPLES = 16_000 * 30;

export class LocalAudioRecorder {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.chunks = [];
    this.samples = 0;
    this.recording = false;
  }

  async start() {
    if (!isLocalCaptureSupported()) {
      throw new Error("Captura de áudio não suportada neste ambiente.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.context = new Context();
      if (this.context.state === "suspended") await this.context.resume();

      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor =
        this.context.createScriptProcessor?.(4096, 1, 1) ||
        this.context.createJavaScriptNode?.(4096, 1, 1);
      if (!this.processor) throw new Error("Web Audio não suporta captura.");

      this.chunks = [];
      this.samples = 0;
      this.processor.onaudioprocess = (event) => {
        if (!this.recording || this.samples >= MAX_SAMPLES) return;
        const data = new Float32Array(event.inputBuffer.getChannelData(0));
        this.chunks.push(data);
        this.samples += data.length;
      };
      this.source.connect(this.processor);
      // WebKitGTK só dispara onaudioprocess se o nó estiver ligado a um destino.
      // O ganho zero evita devolver o áudio ao alto-falante.
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.processor.connect(this.silentGain);
      this.silentGain.connect(this.context.destination);
      this.recording = true;
      return this;
    } catch (error) {
      // getUserMedia já tinha concedido a track: nunca deixe o microfone ligado.
      await this.release();
      throw error;
    }
  }

  /**
   * Devolve o áudio acumulado como WAV e esvazia o buffer SEM encerrar a
   * gravação. Usado pela wake word: o microfone continua aberto enquanto a
   * janela anterior é transcrita, evitando buracos entre janelas.
   */
  drain() {
    if (!this.chunks.length) return null;
    const chunks = this.chunks;
    const samples = this.samples;
    this.chunks = [];
    this.samples = 0;
    return encodeWav(chunks, this.context?.sampleRate || 16000);
  }

  async stop() {
    this.recording = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // Já desconectado.
      }
    }
    const sampleRate = this.context?.sampleRate || 16000;
    const blob = encodeWav(this.chunks, sampleRate);
    await this.release();
    return blob;
  }

  /** Encerra sem devolver áudio (unmount/troca de modo). */
  async cancel() {
    this.recording = false;
    if (this.processor) this.processor.onaudioprocess = null;
    await this.release();
  }

  async release() {
    for (const node of [this.processor, this.silentGain, this.source]) {
      try {
        node?.disconnect();
      } catch {
        // Já desconectado.
      }
    }
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    try {
      await this.context?.close();
    } catch {
      // Contexto já fechado.
    }
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.chunks = [];
    this.samples = 0;
  }
}
