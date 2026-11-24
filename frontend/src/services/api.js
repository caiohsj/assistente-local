/**
 * Cliente do backend Python/FastAPI.
 *
 * Usa `fetch` comum (sem plugin HTTP do Tauri): o mesmo código funciona no
 * WebView e no navegador. `VITE_API_BASE` tem fallback para o backend local;
 * em build de produção ele é lido em tempo de build (`npm run tauri:build`).
 */

export const MESSAGE_MAX_LENGTH = 12000;

const API = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8765").replace(/\/$/, "");

// LLM_TIMEOUT_SECONDS=180 no backend; uma folga evita cortar respostas válidas.
const DEFAULT_TIMEOUT_MS = 200_000;

/** Erro com `status` e `detail` quando o FastAPI responde com 4xx/5xx. */
export class ApiError extends Error {
  constructor(message, { status, detail, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.name === "TimeoutError";
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(
  path,
  { method = "GET", body, raw = false, contentType, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timer = setTimeout(() => {
    const timeout = new Error("Tempo limite excedido ao contatar o backend.");
    timeout.name = "TimeoutError";
    controller.abort(timeout);
  }, timeoutMs);

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers:
        body === undefined
          ? undefined
          : { "Content-Type": raw ? contentType || "application/octet-stream" : "application/json" },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw error;
    throw new ApiError("Não foi possível contatar o backend local.", { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  const data = await parseJson(response);
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : undefined;
    throw new ApiError(detail || `Falha em ${path}: ${response.status}`, {
      status: response.status,
      detail,
    });
  }
  return data;
}

/** GET /health → { backend, llama_server, database, model_available, tools } */
export function fetchHealth(options = {}) {
  return request("/health", options);
}

/** GET /history → { messages: [{ id, role, content, error, created_at }] } */
export function fetchHistory(limit = 100, options = {}) {
  return request(`/history?limit=${encodeURIComponent(limit)}`, options);
}

/** POST /chat → { reply, model, tool_calls: [...] } */
export function sendChatMessage(message, options = {}) {
  return request("/chat", { ...options, method: "POST", body: { message } });
}

/** POST /transcribe → { text }. Corpo bruto (WAV), não JSON. */
export function transcribeAudio(blob, options = {}) {
  return request("/transcribe", {
    ...options,
    method: "POST",
    body: blob,
    raw: true,
    contentType: blob?.type || "audio/wav",
    // O modelo pode precisar ser baixado na primeira chamada.
    timeoutMs: options.timeoutMs ?? 180_000,
  });
}
