import { useEffect, useRef } from "react";

function messageClass(message) {
  const classes = [
    "assistant-message",
    `assistant-message--${message.role === "user" ? "user" : "assistant"}`,
  ];
  if (message.error) classes.push("assistant-message--error");
  if (message.failed) classes.push("assistant-message--failed");
  return classes.join(" ");
}

/** Lista rolável com as mensagens persistidas pelo backend. */
export default function AssistantConversation({ messages = [], toolCalls = [], sending = false }) {
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, toolCalls, sending]);

  return (
    <div
      className="assistant-conversation"
      role="log"
      aria-live="polite"
      aria-label="Histórico da conversa"
      ref={listRef}
    >
      {messages.map((message, index) => (
        <article
          key={message.id ?? `${message.created_at ?? "msg"}-${index}`}
          className={messageClass(message)}
        >
          <div className="assistant-message__meta">
            <span>{message.role === "user" ? "Você" : "Assistente"}</span>
            {message.pending ? <span className="assistant-message__sent-label">enviando…</span> : null}
            {message.failed ? <span className="assistant-message__failed-label">não enviada</span> : null}
            {message.error ? <span className="assistant-message__error-label">erro</span> : null}
          </div>
          <p className="assistant-message__text">{message.content}</p>
        </article>
      ))}

      {sending ? (
        <div
          className="assistant-message assistant-message--assistant assistant-message--pending"
          aria-label="Assistente pensando"
        >
          <span className="assistant-message__dots" aria-hidden="true">•••</span>
        </div>
      ) : null}

      {toolCalls.length > 0 ? (
        <div className="assistant-tool-chips">
          <span className="assistant-tool-chips__label">Ferramentas usadas</span>
          {toolCalls.map((call, index) => (
            <span
              key={`${call.tool ?? "tool"}-${index}`}
              className={`assistant-tool-chip${call.ok ? "" : " assistant-tool-chip--error"}`}
              title={call.summary || call.error_code || call.tool || ""}
            >
              <span aria-hidden="true">{call.ok ? "✓" : "!"}</span>{" "}
              {call.tool ?? "ferramenta"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
