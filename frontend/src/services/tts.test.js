import { describe, expect, it, vi } from "vitest";
import { SpeechPlayer, buildSpeech, isSimpleReply, plainText } from "./tts.js";

describe("buildSpeech", () => {
  it("devolve texto limpo para respostas curtas e simples", () => {
    expect(buildSpeech("**Pronto!** Abri o terminal 😊")).toBe("Pronto! Abri o terminal");
    expect(buildSpeech("Acho que sim.")).toBe("Acho que sim.");
  });

  it("não fala Markdown estruturado", () => {
    expect(
      buildSpeech("1. **Terminal**: use\n2. `htop`\n3. `top`")
    ).toBeNull();
    expect(buildSpeech("```bash\nhtop\n```")).toBeNull();
    expect(buildSpeech("## Título\n\nTexto")).toBeNull();
    expect(buildSpeech("| a | b |\n| - | - |\n| 1 | 2 |")).toBeNull();
    expect(buildSpeech("Primeiro parágrafo.\n\nSegundo parágrafo.")).toBeNull();
  });

  it("respeita limite de tamanho e de frases", () => {
    expect(buildSpeech("x".repeat(30), { maxChars: 10 })).toBeNull();
    expect(buildSpeech("Um. Dois. Três. Quatro.")).toBeNull();
    expect(isSimpleReply("")).toBe(false);
  });

  it("remove links e URLs do texto falado", () => {
    expect(plainText("Veja [aqui](https://example.com) em https://site.org")).toBe(
      "Veja aqui em"
    );
  });
});

describe("SpeechPlayer", () => {
  class FakeAudio {
    constructor() {
      this.src = null;
      this.played = false;
      this.paused = false;
      FakeAudio.instances.push(this);
    }
    static instances = [];
    async play() {
      this.played = true;
    }
    pause() {
      this.paused = true;
    }
  }

  function makePlayer(overrides = {}) {
    const callbacks = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    };
    const revoke = vi.fn();
    const player = new SpeechPlayer({
      AudioCtor: FakeAudio,
      createObjectURL: () => "blob:wav",
      revokeObjectURL: revoke,
      ...callbacks,
    });
    return { player, callbacks, revoke };
  }

  it("toca e libera a URL ao terminar", async () => {
    FakeAudio.instances = [];
    const { player, callbacks, revoke } = makePlayer();
    const blob = new Blob(["wav"], { type: "audio/wav" });

    await player.play(blob);
    expect(FakeAudio.instances[0].src).toBe("blob:wav");
    expect(FakeAudio.instances[0].played).toBe(true);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);

    FakeAudio.instances[0].onended();
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:wav");
    expect(player.playing).toBe(false);
  });

  it("stop() interrompe e notifica o fim", async () => {
    FakeAudio.instances = [];
    const { player, callbacks, revoke } = makePlayer();
    await player.play(new Blob(["wav"]));

    player.stop();
    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:wav");
  });

  it("reporta erro de reprodução", async () => {
    FakeAudio.instances = [];
    const { player, callbacks } = makePlayer();
    const original = FakeAudio.prototype.play;
    FakeAudio.prototype.play = vi.fn().mockRejectedValue(new Error("autoplay bloqueado"));
    try {
      await player.play(new Blob(["wav"]));
      expect(callbacks.onError).toHaveBeenCalledTimes(1);
      expect(callbacks.onStart).not.toHaveBeenCalled();
    } finally {
      FakeAudio.prototype.play = original;
    }
  });

  it("ignora o fim de uma faixa substituída", async () => {
    FakeAudio.instances = [];
    const { player, callbacks } = makePlayer();
    const original = FakeAudio.prototype.play;
    FakeAudio.prototype.play = vi.fn(function () {
      return new Promise((resolve) => {
        this.resolvePlay = resolve;
      });
    });
    try {
      const first = player.play(new Blob(["a"]));
      const second = player.play(new Blob(["b"]));
      expect(FakeAudio.instances).toHaveLength(2);
      FakeAudio.instances[0].resolvePlay();
      await first;
      FakeAudio.instances[1].resolvePlay();
      await second;
      expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    } finally {
      FakeAudio.prototype.play = original;
    }
  });
});
