import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  MESSAGE_MAX_LENGTH,
  fetchHealth,
  fetchHistory,
  isAbortError,
  sendChatMessage,
} from "./api.js";

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: vi.fn(async () => data) };
}

function pendingFetch() {
  return vi.fn(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("abort");
          error.name = "AbortError";
          reject(error);
        });
      })
  );
}

// Anexa o handler de rejeição antes de disparar o abort/timeout, evitando
// que o Node reporte um unhandled rejection entre os microtasks.
function capture(promise) {
  return promise.then(
    () => null,
    (error) => error
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api.js", () => {
  it("fetchHealth devolve o contrato do /health", async () => {
    const payload = {
      backend: "ok",
      llama_server: "reachable",
      database: "ok",
      model_available: true,
      tools: { enabled: true, count: 2 },
    };
    globalThis.fetch.mockResolvedValue(jsonResponse(payload));

    await expect(fetchHealth()).resolves.toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetchHistory aplica o limite e normaliza mensagens", async () => {
    const messages = [{ id: 1, role: "user", content: "oi", error: 0, created_at: "now" }];
    globalThis.fetch.mockResolvedValue(jsonResponse({ messages }));

    await expect(fetchHistory(100)).resolves.toEqual({ messages });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/history?limit=100",
      expect.any(Object)
    );
  });

  it("sendChatMessage envia POST JSON e devolve reply/model/tool_calls", async () => {
    const payload = {
      reply: "Olá!",
      model: "local-qwen3-4b",
      tool_calls: [{ tool: "get_current_datetime", summary: "data/hora", ok: true }],
    };
    globalThis.fetch.mockResolvedValue(jsonResponse(payload));

    await expect(sendChatMessage(" oi ")).resolves.toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: " oi " }),
      })
    );
    expect(MESSAGE_MAX_LENGTH).toBe(12000);
  });

  it("503 expõe status e detail amigável do FastAPI", async () => {
    globalThis.fetch.mockResolvedValue(
      jsonResponse(
        { detail: "Falha ao consultar o modelo local." },
        { ok: false, status: 503 }
      )
    );

    await expect(sendChatMessage("oi")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      detail: "Falha ao consultar o modelo local.",
      message: "Falha ao consultar o modelo local.",
    });
  });

  it("falha de rede vira ApiError sem status", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchHealth()).rejects.toMatchObject({
      name: "ApiError",
      status: undefined,
      message: "Não foi possível contatar o backend local.",
    });
  });

  it("JSON inválido é tratado sem quebrar o parsing", async () => {
    const response = jsonResponse(null);
    response.json.mockRejectedValue(new SyntaxError("not json"));
    response.ok = false;
    response.status = 500;
    globalThis.fetch.mockResolvedValue(response);

    await expect(fetchHistory()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Falha em /history?limit=100: 500",
    });
  });

  it("signal externo aborta a requisição", async () => {
    globalThis.fetch.mockImplementation(pendingFetch());
    const controller = new AbortController();

    const outcome = capture(sendChatMessage("oi", { signal: controller.signal }));
    controller.abort();

    expect(isAbortError(await outcome)).toBe(true);
  });

  it("timeout aborta requisições sem resposta", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockImplementation(pendingFetch());

    const outcome = capture(sendChatMessage("oi", { timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(500);

    expect(isAbortError(await outcome)).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("ApiError preserva status/detail", () => {
    const error = new ApiError("erro", { status: 503, detail: "detalhe" });
    expect(error).toBeInstanceOf(Error);
    expect([error.status, error.detail]).toEqual([503, "detalhe"]);
  });
});
