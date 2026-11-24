# Mestre — MVP 0.4

Base local-first: FastAPI + llama.cpp + SQLite + React/Vite.

Esta versão entrega conversa local com histórico persistente, ferramentas de **leitura** (arquivos e sistema) sob allowlist, **abertura de aplicativos e sites** e **captura por voz opcional** (ativada por variável de ambiente, incluindo atalho global e wake word "Mestre"). Não executa comandos com argumentos, não escreve arquivos, não acessa WhatsApp/e-mail. O microfone só fica ativo se você habilitar a voz — e, no modo wake word, permanece em escuta contínua enquanto o app estiver aberto.

## Requisitos

- Python 3.10+
- Node.js 20+
- `llama-server` compilado com CUDA e HTTPS
- Modelo GGUF baixado

## 1. Inicie o modelo

No terminal 1 (mantenha-o aberto):

```bash
cd ~/llama.cpp
./build/bin/llama-server \
  -hf Qwen/Qwen3-4B-GGUF:Q4_K_M \
  --alias local-qwen3-4b \
  --jinja \
  --host 127.0.0.1 \
  --port 8081 \
  -ngl 99 \
  -c 8192
```

O `--alias` deve corresponder a `LLAMA_MODEL`. Se o servidor reportar um único modelo, o `/health` também aceita esse cenário (`model_match: single_model`).

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

Para rodar os testes, instale também `pip install -r requirements-dev.txt`.

Verifique `http://127.0.0.1:8765/health`. A resposta separa:

- `backend`: o processo respondeu;
- `database`: o SQLite respondeu;
- `model_available`: o alias configurado foi encontrado (ou há um único modelo servido);
- `tools`: famílias de ferramentas ativas.

## 3. Inicie a interface

No terminal 3:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Abra o endereço mostrado pelo Vite, normalmente `http://127.0.0.1:5173`. Para apontar para outro backend, ajuste `VITE_API_BASE` (o fallback é `http://127.0.0.1:8765`). Como é uma variável `VITE_*`, ela é lida em tempo de build: em `npm run tauri:build`, defina-a antes de compilar.

## Configuração

Edite `backend/.env` conforme necessário.

### Conversa e persistência

| Chave | Default | Observação |
|---|---|---|
| `LLAMA_BASE_URL` | `http://127.0.0.1:8081/v1` | Servidor OpenAI-compatível |
| `LLAMA_API_KEY` | `local` | Valor fictício para o llama.cpp |
| `LLAMA_MODEL` | `local-qwen3-4b` | Deve casar com o alias do servidor |
| `LLM_TIMEOUT_SECONDS` | `180` | Timeout do cliente |
| `TEMPERATURE` | `0.6` | Geração |
| `MAX_TOKENS` | `900` | Limite por resposta |
| `DB_PATH` | `./data/assistant.sqlite3` | SQLite local |
| `MAX_HISTORY_MESSAGES` | `12` | Contexto enviado ao modelo |
| `CORS_ORIGIN_REGEX` | `^(?:http://(?:127\.0\.0\.1\|localhost):\d+\|tauri://localhost\|http://tauri\.localhost)$` | Loopback (Vite) + origens exatas do WebView Tauri |

O banco usa WAL, `busy_timeout=5000` e `foreign_keys=ON`. A coluna `messages.error` é migrada automaticamente em bancos antigos. Falhas do modelo persistem a pergunta e uma linha de erro (`error=1`), retornam **503** e não reenviam a linha de erro ao modelo.

> **Atualização de CORS:** quem já tem `backend/.env` de versões anteriores precisa copiar manualmente a linha `CORS_ORIGIN_REGEX` do `.env.example`. O regex antigo aceitava apenas Vite; sem a atualização, a janela Tauri recebe 403 (origens `tauri://localhost` e `http://tauri.localhost`). Nunca use `*` — a lista continua restrita a loopback e às origens exatas do WebView.

### Ferramentas de leitura (Etapa 2)

| Chave | Default |
|---|---|
| `TOOLS_ENABLED` | `false` |
| `TOOL_READ_ROOTS` | vazio (CSV de raízes absolutas) |
| `TOOL_DENY_GLOBS` | `.env,.git/**,.ssh/**,.gnupg/**,*.pem,id_rsa*,node_modules/**,.venv/**` |
| `TOOL_MAX_FILE_BYTES` | `262144` |
| `TOOL_MAX_ENTRIES` | `200` |
| `TOOL_MAX_RESULTS` | `50` |
| `TOOL_SEARCH_TIMEOUT_SECONDS` | `5` |
| `TOOL_RESULT_MAX_CHARS` | `4000` |
| `AGENT_MAX_TOOL_ROUNDS` | `4` |
| `AGENT_MAX_TOOL_CALLS` | `6` |
| `PROCESS_LIST_DEFAULT_LIMIT` | `15` |
| `PROCESS_LIST_MAX_LIMIT` | `50` |
| `GPU_QUERY_TIMEOUT_SECONDS` | `2` |

Exemplo para habilitar leitura apenas em um diretório de notas:

```bash
TOOLS_ENABLED=true
TOOL_READ_ROOTS=/home/seu-usuario/notas
```

Regras de segurança:

- `TOOLS_ENABLED=false` desliga tudo.
- Sem `TOOL_READ_ROOTS`, a família de arquivos fica ausente; a família de sistema continua ativa.
- Prefira raízes específicas (por exemplo, uma pasta de notas). Usar `/` como raiz amplia muito a superfície de leitura; os deny-globs não substituem uma allowlist bem escolhida.
- Caminhos relativos partem da primeira raiz autorizada; `~` é expandido.
- `..`, symlinks para fora das raízes, devices, FIFOs, sockets e deny-globs são recusados.
- Raiz inválida com ferramentas ligadas impede o startup.
- Ferramentas de leitura disponíveis: `list_dir`, `read_file`, `search_text`, `get_system_info`, `get_disk_usage`, `list_processes`, `get_current_datetime`. A abertura de apps/sites está na seção seguinte.
- `list_processes` não retorna `cmdline`. GPU usa `nvidia-smi` com argv fixo, `shell=False` e timeout; ausência degrada para `available: false`.
- Toda chamada gera auditoria em `tool_calls` (`tool`, `args_json`, `ok`, `error_code`, `duration_ms`, `result_chars`), sem conteúdo de arquivos.

### Abertura de aplicativos e sites (Etapa 3)

A família `apps` (`open_app` e `open_url`) existe sempre que `TOOLS_ENABLED=true`. Não há `TOOL_OPEN_ENABLED`: **ligar ferramentas liga também a abertura de apps e sites**. Esse é um trade-off explícito.

| Chave | Default | Observação |
|---|---|---|
| `TOOL_OPEN_URL_COMMAND` | `xdg-open` | Executável único, sem argumentos |
| `TOOL_OPEN_URL_DOMAINS` | vazio | CSV de domínios; vazio libera qualquer host |
| `TOOL_OPEN_URL_MAX_CHARS` | `2048` | Limite da URL |
| `TOOL_OPEN_APP_ALIASES` | `terminal=x-terminal-emulator\|gnome-terminal\|konsole\|alacritty\|kitty\|xterm` | Candidatos tentados na ordem |
| `TOOL_OPEN_APP_DENY` | vazio | CSV de executáveis bloqueados (aceita também IDs Flatpak) |

Contratos:

```json
open_app({"app": "firefox"})
open_url({"url": "https://example.com"})
```

Retornos:

```json
{"app": "firefox", "command": "firefox", "pid": 1234, "launched": true}
{"url": "https://example.com", "host": "example.com", "pid": 1234, "launched": true}
```

Regras:

- `open_app` aceita apenas nome simples de executável do `PATH`: sem `/`, `\`, `..`, espaços, NUL ou começo com `-`.
- Se o nome for um alias configurado, os candidatos são tentados na ordem e o primeiro instalado é usado. O modelo também pode pedir `firefox`, `code` etc. diretamente.
- Se o nome não existir no `PATH`, `open_app` tenta um app **Flatpak** instalado pelo ID completo, nome de exibição ou último componente do ID. Exemplos: `telegram` → `org.telegram.desktop`; `discord` → `com.discordapp.Discord`. A resposta inclui `app_id` nesse caso.
- Não há argumentos extras: o modelo não consegue montar comandos. A execução usa `shell=False`, sessão nova e stdio em `DEVNULL`.
- `open_url` aceita apenas `http` e `https`; bloqueia `file://`, `javascript:`, `data:`, URLs com credenciais (`user:pass@`) e caracteres de controle.
- `TOOL_OPEN_URL_DOMAINS` vazio libera qualquer domínio; preenchido aceita host exato ou subdomínio.
- Abrir um site **não** lê nem resume o conteúdo da página.
- Pedidos explícitos como “abra o Telegram” sempre chamam a ferramenta na hora, mesmo que uma mensagem antiga na conversa tenha dito que não era possível. Para isso, o agente força o `tool_choice` e usa apenas a mensagem atual como contexto.
- Auditoria: `open_url` grava apenas `scheme://host` (sem query string nem fragmento); `open_app` grava apenas o nome solicitado.

As válvulas de segurança são `TOOL_OPEN_APP_DENY` (bloqueia executáveis específicos) e `TOOL_OPEN_URL_DOMAINS` (restringe sites). Sem argumentos, o risco de comando destrutivo é baixo, mas executáveis com efeito imediato continuam possíveis.

### Captura por voz (Etapa 4)

O assistente se chama **Mestre**. A voz é **desligada por padrão** e exige as duas válvulas abaixo — se só uma estiver ligada, o microfone permanece desabilitado e o modo texto continua funcionando.

| Chave | Onde | Default | Observação |
|---|---|---|---|
| `VOICE_ENABLED` | `backend/.env` | `false` | Publica `voice` em `/health` |
| `VOICE_WAKE_WORD` | `backend/.env` | `mestre` | Palavra de ativação do modo wake word |
| `VOICE_LANGUAGE` | `backend/.env` | `pt-BR` | Idioma da transcrição (BCP 47) |
| `VOICE_STT_MODEL` | `backend/.env` | `tiny` | Modelo faster-whisper (`tiny`, `base`, `small`…) |
| `VOICE_STT_DEVICE` | `backend/.env` | `cpu` | `cpu` ou `cuda` |
| `VOICE_STT_COMPUTE_TYPE` | `backend/.env` | `int8` | Precisão do CTranslate2 |
| `VOICE_STT_LANGUAGE` | `backend/.env` | `pt` | Idioma do Whisper (`pt`, `en`, `auto`) |
| `VOICE_MAX_AUDIO_BYTES` | `backend/.env` | `10485760` | Limite do corpo em `/transcribe` |
| `VITE_VOICE_ENABLED` | `frontend/.env` | `false` | Lido no build do Vite (também vale para `tauri:build`) |
| `VITE_VOICE_LANGUAGE` | `frontend/.env` | `pt-BR` | Usado apenas se o backend não informar `VOICE_LANGUAGE` |

```bash
# backend/.env
VOICE_ENABLED=true
VOICE_WAKE_WORD=mestre
VOICE_LANGUAGE=pt-BR

# STT local — usado no app desktop (Tauri/WebKitGTK não tem Web Speech API)
VOICE_STT_MODEL=tiny
VOICE_STT_DEVICE=cpu
VOICE_STT_COMPUTE_TYPE=int8
VOICE_STT_LANGUAGE=pt
```

```bash
# frontend/.env
VITE_VOICE_ENABLED=true
VITE_VOICE_LANGUAGE=pt-BR
```

Dois modos, selecionáveis na interface (a escolha vale pela sessão; ao reiniciar o app, o modo volta para **Atalho** — decisão de privacidade para não reabrir o microfone sem reconfirmação):

- **Atalho** (padrão): `Ctrl+Shift+M` (ou `Cmd+Shift+M`) abre a janela e já inicia a captura. O item **Falar com Mestre** no menu da bandeja faz o mesmo.
- **Dizer "mestre"**: escuta contínua; ao reconhecer a palavra, a janela abre e a captura começa. O texto da wake word **não** é enviado ao chat.

O botão do microfone no campo de mensagem também inicia/para a captura manualmente. O resultado final da transcrição é enviado como uma mensagem normal (`/chat`).

**Dois motores de transcrição, escolhidos automaticamente:**

1. **Web Speech API** — usada no navegador (Chrome/Chromium). A transcrição acontece no provedor do navegador e pode usar rede.
2. **STT local (padrão no desktop)** — o WebView WebKitGTK do Tauri no Linux não implementa `SpeechRecognition`. Nesses casos o app grava áudio com Web Audio e envia um WAV curto para `POST /transcribe`, onde o **faster-whisper** transcreve localmente. Nenhum áudio sai da máquina nesse caminho.

No Linux o Rust habilita `enable-media-stream` no WebKitGTK e responde ao pedido de permissão de microfone **somente para as origens do próprio app** (`tauri://localhost`, `http://tauri.localhost` e a origem Vite de dev). Outros tipos de permissão continuam com o tratamento padrão.

> Na primeira transcrição local o modelo é baixado do HuggingFace (o `tiny` tem ~75 MB) e carregado em memória. A primeira chamada pode demorar alguns segundos; depois fica rápido. O `faster-whisper` já faz parte de `backend/requirements.txt`.

**Limitações importantes:** no modo wake word com STT local o áudio é processado em janelas de ~3,5 s (consumo de CPU maior e latência de até esse valor). Reconhecimento contínuo em janela oculta pode ser suspenso pelo sistema — o modo wake word é mais confiável com a janela visível. A precisão depende do modelo escolhido (`tiny` prioriza velocidade).

### Endpoints

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/health` | Backend, banco, modelo, famílias de ferramentas (`files`, `system`, `apps`) e configuração de voz |
| `GET` | `/history?limit=100` | Histórico (1–500, inclui linhas de erro) |
| `POST` | `/chat` | Conversa com loop de ferramentas |
| `POST` | `/transcribe` | Áudio bruto (WAV) → `{ "text": "..." }` via faster-whisper |
| `GET` | `/tools` | Matriz de habilitação, raízes, aliases, denylist, domínios e caps |
| `POST` | `/tools/{name}` | Execução direta para depuração |

## Como validar

### Suíte automatizada

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
pytest -q
```

Ou, da raiz:

```bash
./scripts/check.sh
```

O script roda `pytest`, `compileall`, `npm test` (Vitest + Testing Library) e `npm run build`.

### Smoke real

Com modelo e backend ativos:

```bash
python3 scripts/smoke.py
python3 scripts/smoke.py --skip-chat
```

O smoke falha se o backend ou o banco estiverem indisponíveis e, por padrão, exige uma resposta real do modelo.

### Checklist manual

1. Envie uma mensagem e confirme a resposta.
2. Reinicie o backend e recarregue a UI: o histórico deve permanecer.
3. Pare o `llama-server` e envie uma mensagem: a UI mostra erro, a pergunta permanece e o `/history` contém a linha de erro.
4. Com `TOOLS_ENABLED=true` e `TOOL_READ_ROOTS` configurado, peça “que horas são”, “quanto de RAM”, “liste 5 processos”, “use o disco”, “leia o arquivo X”.
5. Peça a leitura de `.env` ou de um caminho fora das raízes: a ferramenta deve recusar.
6. Confirme no cabeçalho o indicador de allowlist, o selo `APPS ON` e os chips das ferramentas usadas.
7. Com `TOOLS_ENABLED=true`, peça “abra o terminal” e “abra https://example.com”. Confirme os chips `abriu terminal` e `abriu example.com`.
8. Peça um nome com caminho (`/usr/bin/firefox`) ou uma URL `file:///etc/passwd`: a ferramenta deve recusar.
9. Se `TOOL_OPEN_URL_DOMAINS` estiver preenchido, peça um domínio fora da lista: a ferramenta deve recusar com `forbidden_target`.
10. Confira em `tool_calls` que a URL foi gravada apenas como `scheme://host`, sem query string nem fragmento.
11. Com voz desabilitada, confira que o microfone está cinza e que digitar continua funcionando.
12. Com as duas variáveis ligadas, clique no microfone, fale e confirme que a transcrição vira mensagem no `/history`.
13. Pressione `Ctrl+Shift+M`: a janela abre e a captura começa; repita no menu da bandeja (**Falar com Mestre**).
14. Selecione **dizer "mestre"**, chame por Mestre e confirme que a janela abre ouvindo sem enviar a palavra de ativação ao chat.
15. Negue a permissão de microfone: a UI mostra a mensagem de erro e o modo texto continua disponível.
16. No modo wake word, chame "Mestre" duas vezes seguidas: a escuta deve rearmar após a primeira captura (só um reconhecedor ativo por vez).
17. Reinicie o app: o modo deve voltar para **Atalho**, sem reabrir o microfone automaticamente.
18. No desktop, confirme em `/health` que `voice.stt_available` é `true`; na primeira captura o modelo `tiny` é baixado e o status mostra **Transcrevendo…**.

## Limitações atuais

- Histórico **global** por instalação; ainda não há múltiplas conversas nem usuários.
- Sem streaming de tokens.
- Arquivos e sistema são somente leitura. A abertura de apps/sites é a única ação com efeito colateral; não há escrita, execução de comandos com argumentos nem aprovação por chamada.
- Abrir um app ou site não permite ler o conteúdo resultante.
- Allowlist é global e definida no `.env`.
- Sem autenticação: o backend e a UI escutam somente em `127.0.0.1`. Não exponha essas portas na rede.
- GPU NVIDIA é opcional; a ausência de `nvidia-smi` não quebra a ferramenta de sistema.
- No desktop (Tauri/Linux) a transcrição usa o modelo local `tiny`; áudio trafega apenas entre o WebView e o backend, em loopback. No navegador, a Web Speech API pode usar o provedor do navegador.
- O modo wake word mantém o reconhecedor contínuo remontando enquanto estiver selecionado — isso consome recursos e pode ser suspenso em janela oculta.

## MVP Desktop (Tauri 2)

O frontend também roda como aplicativo desktop residente: janela flutuante sem bordas, ícone na bandeja do sistema e menu **Abrir / Ocultar / Sair**. A janela agora conversa com o **mesmo backend FastAPI** do MVP web: ao abrir, consulta `/health` e `/history`; ao enviar, chama `/chat` e recarrega o histórico. O modelo e o backend continuam sendo iniciados manualmente (sem sidecar nesta etapa).

São três terminais, nesta ordem:

1. **Terminal 1 — llama-server:** o comando da seção 1 acima (`llama-server ... --port 8081`).
2. **Terminal 2 — backend:** o comando da seção 2 acima (`uvicorn app.main:app --host 127.0.0.1 --port 8765`). Confira `http://127.0.0.1:8765/health`.
3. **Terminal 3 — janela desktop:**

```bash
cd frontend
npm install
npm run tauri:dev     # aplicativo com bandeja e janela nativa (Vite na porta 5180)
npm run tauri:build   # gera .deb/AppImage em src-tauri/target/release/bundle/
```

Para pré-visualizar no navegador, use `npm run dev` (porta 5173) com o backend ligado. `VITE_API_BASE` é lido em tempo de build — configure-o antes de `npm run tauri:build` se o backend não estiver no endereço padrão. Se trocar a **porta**, acrescente também `http://127.0.0.1:<porta>` ao `connect-src` do CSP em `frontend/src-tauri/tauri.conf.json`; o CSP não usa curinga de porta.

A janela usa `fetch` comum: o CSP do WebView libera `connect-src` apenas para `127.0.0.1:8765`/`localhost:8765`, e o CORS do FastAPI aceita somente loopback e as origens exatas do Tauri. Ao enviar, a pergunta aparece imediatamente na conversa e o campo é limpo; o histórico recarregado depois substitui a bolha provisória pela linha persistida. Sem o backend, o badge mostra `offline`, a bolha fica marcada como `não enviada` e o campo já foi limpo; com o `llama-server` parado, `/chat` responde 503 e a pergunta permanece no `/history`. Requisitos de compilação no Linux, limitações do AppIndicator/GNOME e detalhes de segurança estão em [docs/desktop-mvp.md](docs/desktop-mvp.md).

## Próximas etapas

1. Memória de longo prazo com fatos aprovados e busca SQLite FTS5.
2. Múltiplas conversas e busca no histórico.
3. ~~Captura por voz (STT) com atalho global e wake word.~~ **Concluído** — ver seção de voz acima. Restam push-to-talk e TTS sob demanda.
4. ~~Empacotamento com Tauri e mascote flutuante.~~ **Concluído** — ver MVP Desktop acima.
5. ~~Ligar os controles visuais ao backend FastAPI/llama.cpp sem reconstruir os componentes.~~ **Concluído** — ver MVP Desktop acima.
6. Integração com calendário/e-mail. Avaliar WhatsApp apenas por integração oficial.
