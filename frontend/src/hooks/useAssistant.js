import { useCallback, useEffect, useRef, useState } from "react";
import {
  MESSAGE_MAX_LENGTH,
  fetchHealth,
  fetchHistory,
  isAbortError,
  sendChatMessage,
} from "../services/api.js";

function toMessages(data) {
  return Array.isArray(data?.messages) ? data.messages : [];
}

/**
 * Estado da conversa. A mensagem aparece na hora como bolha provisória e o
 * campo limpa no aceite; após /chat (sucesso ou 503) recarregamos /history,
 * substituindo a bolha pela linha persistida (sem duplicatas).
 */
export function useAssistant() {
  const [messages, setMessages] = useState([]);
  const [connection, setConnection] = useState("checking");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [lastToolCalls, setLastToolCalls] = useState([]);
  const [voice, setVoice] = useState(null);

  const mounted = useRef(true);
  const inflight = useRef(null);
  // Respostas antigas não podem sobrescrever o histórico recarregado após /chat.
  const historyGeneration = useRef(0);
  const connectionGeneration = useRef(0);
  const optimisticId = useRef(0);

  const loadHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    try {
      const data = await fetchHistory(100);
      if (mounted.current && generation === historyGeneration.current) {
        setMessages(toMessages(data));
      }
    } catch (err) {
      if (mounted.current && generation === historyGeneration.current && !isAbortError(err)) {
        setError((current) => current || "Não foi possível carregar o histórico.");
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const historyGen = ++historyGeneration.current;
    const connectionGen = ++connectionGeneration.current;
    // O histórico carrega mesmo com o modelo indisponível; /health só liga
    // com o indicador de conexão.
    Promise.allSettled([fetchHealth(), fetchHistory(100)]).then(([health, history]) => {
      if (!mounted.current) return;
      if (history.status === "fulfilled" && historyGen === historyGeneration.current) {
        setMessages(toMessages(history.value));
      }
      if (connectionGen !== connectionGeneration.current) return;
      if (health.status === "fulfilled") {
        setConnection("online");
        setVoice(health.value?.voice ?? null);
      } else {
        setConnection("offline");
        setError("Backend local indisponível.");
      }
    });
    return () => {
      mounted.current = false;
      inflight.current?.abort();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(
    async (raw, { onAccepted, source = "text" } = {}) => {
      const text = (raw ?? "").trim();
      if (!text) return { ok: false, clearInput: false, error: "Digite uma mensagem." };
      if (text.length > MESSAGE_MAX_LENGTH) {
        return {
          ok: false,
          clearInput: false,
          error: `Mensagem muito longa (máx. ${MESSAGE_MAX_LENGTH} caracteres).`,
        };
      }

      // Guard síncrono: duas chamadas antes do commit do React não podem gerar
      // dois POST /chat (o backend persistiria duas perguntas).
      if (inflight.current) {
        return { ok: false, clearInput: false, error: "Uma mensagem já está sendo enviada." };
      }

      // Aceite imediato: a UI limpa o campo e mostra a bolha antes da resposta.
      onAccepted?.();
      const optimistic = {
        id: `pending-${++optimisticId.current}`,
        role: "user",
        content: text,
        error: 0,
        pending: true,
      };
      if (mounted.current) setMessages((current) => [...current, optimistic]);

      const markFailed = () => {
        if (mounted.current) {
          setMessages((current) =>
            current.map((message) =>
              message.id === optimistic.id
                ? { ...message, pending: false, failed: true }
                : message
            )
          );
        }
      };

      const controller = new AbortController();
      inflight.current = controller;
      setSending(true);
      setError(null);
      setLastToolCalls([]);

      try {
        const result = await sendChatMessage(text, { signal: controller.signal });
        if (mounted.current) {
          connectionGeneration.current += 1;
          setConnection("online");
          setLastToolCalls(Array.isArray(result?.tool_calls) ? result.tool_calls : []);
        }
        // O /history substitui a bolha provisória pela linha persistida.
        await loadHistory();
        return {
          ok: true,
          clearInput: true,
          reply: String(result?.reply ?? ""),
          source,
        };
      } catch (err) {
        if (isAbortError(err)) {
          markFailed();
          if (mounted.current) {
            setError("Tempo limite excedido. Tente novamente em instantes.");
          }
          return { ok: false, clearInput: false };
        }
        if (err?.status === 503) {
          // A pergunta e a linha de erro já foram gravadas pelo backend.
          await loadHistory();
          const message = err.detail || "Falha ao consultar o modelo local.";
          if (mounted.current) {
            connectionGeneration.current += 1;
            setConnection("online");
            setError(message);
          }
          return { ok: false, clearInput: true, error: message };
        }
        markFailed();
        const message = err?.message || "Não foi possível contatar o backend local.";
        if (mounted.current) {
          connectionGeneration.current += 1;
          setError(message);
          setConnection("offline");
        }
        return { ok: false, clearInput: false, error: message };
      } finally {
        if (inflight.current === controller) inflight.current = null;
        if (mounted.current) setSending(false);
      }
    },
    [loadHistory]
  );

  return {
    messages,
    connection,
    sending,
    error,
    lastToolCalls,
    voice,
    sendMessage,
    clearError,
  };
}

export default useAssistant;
