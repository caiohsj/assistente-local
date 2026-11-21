import { useEffect, useRef, useState } from "react";

const API = "http://127.0.0.1:8765";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Verificando modelo local...");
  const endRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/health`).then(r => r.json()).then(data => {
      setStatus(data.llama_server === "reachable"
        ? "Modelo local conectado"
        : "Backend ativo; modelo não conectado");
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Erro ao consultar o modelo");
      setMessages(old => [...old, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages(old => [...old, { role: "assistant", content: `Erro: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header>
        <div className="avatar" aria-hidden="true">✦</div>
        <div><h1>Assistente Local</h1><p><i className="dot" />{status}</p></div>
        <span className="local-tag">LOCAL</span>
      </header>
      <section className="conversation">
        {messages.length === 0 && <div className="welcome">
          <div className="orb">✦</div><h2>Olá! Estou aqui.</h2>
          <p>Esta é a primeira versão do seu assistente local.</p>
          <p className="muted">As conversas ficam armazenadas no SQLite deste computador.</p>
        </div>}
        {messages.map((m, i) => <article className={`message ${m.role}`} key={i}>
          <small>{m.role === "user" ? "Você" : "Assistente"}</small><div>{m.content}</div>
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
      <footer>Assistente local · MVP 0.1 · Sem serviços em nuvem</footer>
    </main>
  );
}
