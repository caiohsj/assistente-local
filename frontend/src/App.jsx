import { useEffect, useRef, useState } from "react";

const API = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8765").replace(/\/$/, "");

function toolLabel(call) {
  if (call.summary) return call.summary;
  return call.tool;
}

function allowlistLabel(tools) {
  if (!tools?.enabled) return "FERRAMENTAS OFF";
  if (tools.files) return `ARQUIVOS: ${tools.roots} RAIZ${tools.roots === 1 ? "" : "ES"}`;
  if (tools.system) return "SISTEMA ON";
  return "SEM FERRAMENTAS";
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Verificando modelo local...");
  const [tools, setTools] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/health`).then(r => r.json()).then(data => {
      setTools(data.tools || null);
      if (data.backend !== "ok") {
        setStatus("Backend indisponível");
      } else if (data.database !== "ok") {
        setStatus("Backend ativo; banco indisponível");
      } else if (data.model_available) {
        setStatus("Modelo local conectado");
      } else {
        setStatus("Backend ativo; modelo não conectado");
      }
    }).catch(() => setStatus("Backend indisponível"));
    fetch(`${API}/history`).then(r => r.json())
      .then(data => setMessages(data.messages || [])).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    setMessages(old => [...old, { role: "user", content: message }]);
    setBusy(true);
    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Erro ao consultar o modelo");
      setMessages(old => [...old, {
        role: "assistant",
        content: data.reply,
        tool_calls: data.tool_calls || []
      }]);
    } catch (err) {
      setMessages(old => [...old, {
        role: "assistant",
        content: `Erro: ${err.message}`,
        error: true
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header>
        <div className="avatar" aria-hidden="true">✦</div>
        <div><h1>Assistente Local</h1><p><i className="dot" />{status}</p></div>
        <div className="tags">
          <span className={`tool-tag ${tools?.files ? "on" : "off"}`}>
            {allowlistLabel(tools)}
          </span>
          <span className="local-tag">LOCAL</span>
        </div>
      </header>
      <section className="conversation">
        {messages.length === 0 && <div className="welcome">
          <div className="orb">✦</div><h2>Olá! Estou aqui.</h2>
          <p>Esta é a primeira versão do seu assistente local.</p>
          <p className="muted">As conversas ficam armazenadas no SQLite deste computador.</p>
        </div>}
        {messages.map((m, i) => <article
          className={`message ${m.role}${m.error ? " error" : ""}`}
          key={m.id ?? i}
        >
          <small>{m.role === "user" ? "Você" : "Assistente"}</small>
          <div>{m.content}</div>
          {m.tool_calls?.length > 0 && <div className="chips">
            {m.tool_calls.map((call, index) => <span
              className={`chip${call.ok ? "" : " fail"}`}
              key={`${call.tool}-${index}`}
              title={`${call.duration_ms} ms · ${call.result_chars} caracteres`}
            >
              {toolLabel(call)}
            </span>)}
          </div>}
        </article>)}
        {busy && <article className="message assistant"><small>Assistente</small><div className="typing">Pensando…</div></article>}
        <div ref={endRef} />
      </section>
      <form onSubmit={send}>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder="Escreva uma mensagem..." rows="2"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }} />
        <button disabled={busy || !text.trim()} aria-label="Enviar">↑</button>
      </form>
      <footer>Assistente local · MVP 0.2 · Sem serviços em nuvem</footer>
    </main>
  );
}
