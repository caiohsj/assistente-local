import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchHealth, fetchHistory, sendChatMessage } from "../services/api.js";
import { useAssistant } from "./useAssistant.js";

vi.mock("../services/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchHealth: vi.fn(),
    fetchHistory: vi.fn(),
    sendChatMessage: vi.fn(),
  };
});

const userMessage = {
  id: 1,
  role: "user",
  content: "oi",
  error: 0,
  created_at: "2026-01-01 00:00:00",
};
const assistantMessage = {
  id: 2,
  role: "assistant",
  content: "Olá!",
  error: 0,
  created_at: "2026-01-01 00:00:01",
};
const errorMessage = {
  id: 2,
  role: "assistant",
  content: "Não foi possível consultar o modelo local.",
  error: 1,
  created_at: "2026-01-01 00:00:01",
};

beforeEach(() => {
  fetchHealth.mockReset().mockResolvedValue({ backend: "ok", model_available: true });
  fetchHistory.mockReset().mockResolvedValue({ messages: [] });
  sendChatMessage.mockReset();
});

describe("useAssistant", () => {
  it("inicia com health e histórico em paralelo", async () => {
    fetchHistory.mockResolvedValueOnce({ messages: [userMessage] });

    const { result } = renderHook(() => useAssistant());

    await waitFor(() => expect(result.current.connection).toBe("online"));
    expect(result.current.messages).toEqual([userMessage]);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(fetchHistory).toHaveBeenCalledWith(100);
  });

  it("expõe a configuração de voz anunciada pelo health", async () => {
    fetchHealth.mockResolvedValueOnce({
      backend: "ok",
      voice: { enabled: true, wake_word: "mestre", language: "pt-BR" },
    });

    const { result } = renderHook(() => useAssistant());
    await waitFor(() =>
      expect(result.current.voice).toEqual({
        enabled: true,
        wake_word: "mestre",
        language: "pt-BR",
      })
    );
  });

  it("carrega histórico mesmo quando o health falha", async () => {
    fetchHealth.mockRejectedValue(new Error("backend fora"));
    fetchHistory.mockResolvedValueOnce({ messages: [userMessage] });

    const { result } = renderHook(() => useAssistant());

    await waitFor(() => expect(result.current.connection).toBe("offline"));
    expect(result.current.messages).toEqual([userMessage]);
  });

  it("mostra a mensagem ao enviar, aceita na hora e guarda tool_calls", async () => {
    fetchHistory
      .mockResolvedValueOnce({ messages: [userMessage] })
      .mockResolvedValueOnce({ messages: [userMessage, assistantMessage] });
    sendChatMessage.mockResolvedValue({
      reply: "Olá!",
      model: "local-qwen3-4b",
      tool_calls: [{ tool: "get_current_datetime", summary: "data/hora", ok: true }],
    });

    const { result } = renderHook(() => useAssistant());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    const onAccepted = vi.fn();
    let response;
    await act(async () => {
      response = await result.current.sendMessage("  oi  ", { onAccepted });
    });

    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenCalledWith(
      "oi",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(response).toEqual({
      ok: true,
      clearInput: true,
      reply: "Olá!",
      source: "text",
    });
    // A bolha provisória é substituída pela linha persistida do /history.
    expect(result.current.messages).toEqual([userMessage, assistantMessage]);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(result.current.lastToolCalls[0].tool).toBe("get_current_datetime");
    expect(result.current.sending).toBe(false);
  });

  it("a bolha aparece antes mesmo do /chat responder", async () => {
    let resolveChat;
    sendChatMessage.mockImplementation(
      () => new Promise((resolve) => { resolveChat = resolve; })
    );

    const { result } = renderHook(() => useAssistant());
    await waitFor(() => expect(result.current.connection).toBe("online"));

    const onAccepted = vi.fn();
    let pending;
    act(() => {
      pending = result.current.sendMessage("oi", { onAccepted });
    });

    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "oi",
      pending: true,
    });

    await act(async () => {
      resolveChat({ reply: "Olá!", tool_calls: [] });
      await pending;
    });
  });

  it("503 recarrega o histórico com a linha de erro e limpa o campo", async () => {
    fetchHistory
      .mockResolvedValueOnce({ messages: [userMessage] })
      .mockResolvedValueOnce({ messages: [userMessage, errorMessage] });
    sendChatMessage.mockRejectedValue(
      new ApiError("Falha ao consultar o modelo local.", {
        status: 503,
        detail: "Falha ao consultar o modelo local.",
      })
    );

    const { result } = renderHook(() => useAssistant());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    let response;
    await act(async () => {
      response = await result.current.sendMessage("oi");
    });

    expect(response.clearInput).toBe(true);
    expect(result.current.error).toBe("Falha ao consultar o modelo local.");
    expect(result.current.messages[1].error).toBe(1);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it("falha de rede marca a bolha como não enviada e o backend como offline", async () => {
    sendChatMessage.mockRejectedValue(
      new ApiError("Não foi possível contatar o backend local.")
    );

    const { result } = renderHook(() => useAssistant());
    await waitFor(() => expect(result.current.connection).toBe("online"));

    const onAccepted = vi.fn();
    let response;
    await act(async () => {
      response = await result.current.sendMessage("oi", { onAccepted });
    });

    expect(onAccepted).toHaveBeenCalledTimes(1); // campo limpo no aceite
    expect(response.clearInput).toBe(false);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "oi",
      pending: false,
      failed: true,
    });
    expect(result.current.error).toBe("Não foi possível contatar o backend local.");
    expect(result.current.connection).toBe("offline");
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("bloqueia duplo envio simultâneo", async () => {
    let resolveChat;
    sendChatMessage.mockImplementation(
      () => new Promise((resolve) => { resolveChat = resolve; })
    );

    const { result } = renderHook(() => useAssistant());
    await waitFor(() => expect(result.current.connection).toBe("online"));

    let first;
    let second;
    act(() => {
      first = result.current.sendMessage("oi");
      second = result.current.sendMessage("oi");
    });

    const secondResult = await second;
    expect(secondResult.clearInput).toBe(false);
    expect(sendChatMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChat({ reply: "Olá!", tool_calls: [] });
      await first;
    });
    expect(result.current.sending).toBe(false);
  });

  it("histórico inicial tardio não sobrescreve mensagens pós-envio", async () => {
    let resolveInitialHistory;
    fetchHistory
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveInitialHistory = resolve; })
      )
      .mockResolvedValueOnce({ messages: [userMessage, assistantMessage] });
    sendChatMessage.mockResolvedValue({ reply: "Olá!", tool_calls: [] });

    const { result } = renderHook(() => useAssistant());
    // O histórico inicial fica pendente de propósito; allSettled ainda não
    // resolveu, então o indicador continua "checking" neste cenário.
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.sendMessage("oi");
    });
    expect(result.current.messages).toEqual([userMessage, assistantMessage]);

    await act(async () => {
      resolveInitialHistory({ messages: [userMessage] });
    });
    expect(result.current.messages).toEqual([userMessage, assistantMessage]);
  });

  it("valida mensagem vazia e acima do limite", async () => {
    const { result } = renderHook(() => useAssistant());

    let blank;
    let tooLong;
    await act(async () => {
      blank = await result.current.sendMessage("   ");
      tooLong = await result.current.sendMessage("x".repeat(12001));
    });

    expect(blank.clearInput).toBe(false);
    expect(tooLong.clearInput).toBe(false);
    expect(tooLong.error).toContain("12000");
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});
