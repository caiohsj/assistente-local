# Assistente Local — MVP 0.1

Base local-first: FastAPI + llama.cpp + SQLite + React/Vite.

Esta primeira fatia entrega conversa local e histórico persistente. Ainda não executa comandos, não acessa WhatsApp/e-mail e não mantém microfone ativo. Essas capacidades serão adicionadas com permissões explícitas.

## Requisitos
- Python 3.10+
- Node.js 20+
- llama-server compilado com CUDA e HTTPS
- Modelo GGUF baixado

## 1. Inicie o modelo
No terminal 1 (mantenha-o aberto):

```bash
cd ~/llama.cpp
./build/bin/llama-server \
  -hf Qwen/Qwen3-4B-GGUF:Q4_K_M \
  --jinja \
  --host 127.0.0.1 \
  --port 8081 \
  -ngl 99 \
  -c 8192
```

## 2. Inicie o backend
No terminal 2:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

Verifique `http://127.0.0.1:8765/health`.

## 3. Inicie a interface
No terminal 3:

```bash
cd frontend
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite, normalmente `http://127.0.0.1:5173`.

## Configuração
Edite `backend/.env` se necessário:
- `LLAMA_BASE_URL=http://127.0.0.1:8081/v1`
- `LLAMA_API_KEY=local` (valor fictício; o servidor local não exige chave)
- `LLAMA_MODEL=local-qwen3-4b` (deve corresponder ao alias do llama-server)

O backend escuta somente em `127.0.0.1`. Não exponha essas portas na rede sem autenticação.

## Próximas etapas
1. Validar conversa e persistência.
2. Criar ferramentas de leitura com allowlist.
3. Adicionar memória de longo prazo com fatos aprovados e busca SQLite FTS5.
4. Adicionar push-to-talk, STT e TTS sob demanda.
5. Empacotar com Tauri e criar mascote flutuante.
6. Integrar calendário/e-mail. Avaliar WhatsApp por meio de integração oficial e suas limitações.
