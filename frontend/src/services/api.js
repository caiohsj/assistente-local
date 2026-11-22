/**
 * Cliente do backend Python/FastAPI — RESERVADO PARA A PRÓXIMA ETAPA.
 *
 * Este módulo foi preservado do MVP 0.3 para que a integração futura não
 * precise reconstruir a interface. Nenhuma função aqui é chamada pelo MVP
 * Desktop: a janela funciona inteiramente sem o backend ligado.
 */

const API = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8765").replace(/\/$/, "");

async function getJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Falha em ${path}: ${response.status}`);
  return response.json();
}

export function fetchHealth() {
  return getJson("/health");
}

export function fetchHistory(limit = 100) {
  return getJson(`/history?limit=${limit}`);
}

export async function sendChatMessage(message) {
  const response = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Erro ao consultar o modelo");
  return data;
}
