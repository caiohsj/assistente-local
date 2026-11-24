import { describe, expect, it } from "vitest";
import { encodeWav, isLocalCaptureSupported } from "./localAudio.js";

describe("localAudio", () => {
  it("codifica PCM mono em um WAV válido", async () => {
    const blob = encodeWav([new Float32Array([0, 1, -1])], 16000);
    // jsdom não implementa Blob.arrayBuffer(); FileReader funciona no browser e no teste.
    const buffer = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(blob);
    });
    const view = new DataView(buffer);
    const text = (offset, length) =>
      String.fromCharCode(...new Uint8Array(buffer, offset, length));

    expect(blob.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6); // 3 amostras * 2 bytes
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it("reporta suporte conforme a presença de getUserMedia e AudioContext", () => {
    // jsdom não implementa nenhum dos dois por padrão.
    expect(isLocalCaptureSupported()).toBe(false);
  });
});
