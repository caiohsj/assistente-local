# MVP Desktop — Assistente Local

Janela flutuante residente com ícone na bandeja do sistema, construída com **Tauri 2 + React + Vite** e ligada ao backend Python/FastAPI já existente. A conversa acontece na janela desktop sem reconstruir a interface e sem substituir o Python; áudio (STT/TTS) continua fora do escopo.

## O que este MVP faz

- Inicia com uma janela sem bordas, escura, translúcida e sempre no topo, posicionada no canto inferior direito da área útil do monitor.
- Mantém um ícone na bandeja do sistema com o menu **Abrir assistente / Ocultar assistente / Sair do aplicativo**.
- O botão `×` da janela **oculta** a janela; o processo permanece residente. O encerramento real só acontece em **Sair**.
- Impede uma segunda instância: abrir o aplicativo novamente traz a janela existente para frente.
- A janela pode ser arrastada pelo cabeçalho e redimensionada entre 340×460 e 760×900 px.
- Ao abrir, consulta `GET /health` (indicador de conexão) e `GET /history?limit=100` em paralelo; o histórico carrega mesmo se o modelo estiver indisponível.
- `Enter` envia a mensagem, `Shift+Enter` quebra linha. A pergunta aparece na hora como bolha provisória e o campo limpa no aceite; o envio usa `POST /chat` e recarrega `/history`, substituindo a bolha pela linha persistida sem duplicatas. Se o backend não responder, a bolha fica marcada como `não enviada`.
- Mensagens com `error=1` são destacadas; os `tool_calls` da última resposta aparecem como chips.
- Com o histórico vazio, mantém o palco original (mascote + status); com mensagens, mostra a conversa rolável com o mascote reduzido.
- Sem backend, mostra `offline` e o erro sem descartar o texto digitado; com `llama-server` parado, o 503 limpa o campo porque a pergunta foi salva.

Fora do escopo desta etapa: STT/TTS e microfone ativo, sidecar/autostart do backend, streaming de tokens, múltiplas conversas, autenticação, exposição da porta em rede e notificações.

## Estrutura adicionada

```
frontend/
├── src/
│   ├── components/Assistant/
│   │   ├── AssistantWindow.jsx   # composição da janela, palco e conversa
│   │   ├── AssistantHeader.jsx   # nome, estado visual, conexão e botões da janela
│   │   ├── AssistantMascot.jsx   # mascote SVG original (idle/hover/active)
│   │   ├── AssistantStatus.jsx   # idle/active/hover + connecting/online/offline/thinking/error
│   │   ├── AssistantConversation.jsx # lista rolável, erros e chips de ferramentas
│   │   └── AssistantControls.jsx # campo ativo, envio, microfone apenas visual
│   ├── hooks/
│   │   ├── useWindowControls.js  # invoke() dos comandos nativos
│   │   └── useAssistant.js       # mensagens, conexão, envio, aborts e tool_calls
│   ├── services/api.js           # cliente FastAPI (fetch comum + timeout + ApiError)
│   ├── styles/assistant.css      # identidade visual glassmorphism + conversa
│   ├── test/setup.js             # matchers do Testing Library para Vitest
│   ├── App.jsx
│   └── main.jsx
└── src-tauri/
    ├── src/lib.rs                # tray, janela, close→hide, single-instance, comandos
    ├── src/main.rs
    ├── capabilities/default.json # nenhuma permissão de API nativa concedida
    ├── tauri.conf.json           # janela, build e empacotamento
    ├── icons/                    # ícones gerados pelo CLI a partir de icon.svg
    └── Cargo.toml
```

## Requisitos no Pop!_OS 22.04

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Node.js 20+ e Rust 1.90+ (o ambiente de desenvolvimento usa Node 24 e Rust 1.95).

O Pop!_OS 22.04 com GNOME/X11 exige a extensão de bandeja. Ela já vem instalada no ambiente validado:

```bash
gnome-extensions list | grep appindicator
# ubuntu-appindicators@ubuntu.com
gnome-extensions enable ubuntu-appindicators@ubuntu.com  # se estiver desativada
```

## Executar

### Pré-visualização no navegador (sem Rust)

Útil para ajustar a interface sem compilar:

```bash
cd frontend
npm install
npm run dev
```

Os botões de janela não fazem nada fora do Tauri; o rodapé mostra `pré-visualização`. Com o backend ligado (seção 2 do README), a conversa funciona igual à janela nativa.

### Aplicativo desktop (com tray e janela nativa)

```bash
cd frontend
npm install
npm run tauri:dev
```

O comando inicia o Vite na porta **5180** (isolada por `VITE_PORT`, evitando colisão com o `npm run dev` comum na 5173) e abre a janela nativa. O backend Python e o `llama-server` **precisam** estar ligados (três terminais: llama-server → backend → `npm run tauri:dev`). Sem eles, o badge fica `offline` e as mensagens de erro aparecem, mas a janela continua abrindo.

`VITE_API_BASE` tem fallback para `http://127.0.0.1:8765`. Em build de produção ele é lido em tempo de build, então defina-o antes de `npm run tauri:build` se o backend estiver em outro endereço. Ao trocar a porta, inclua `http://127.0.0.1:<porta>` no `connect-src` do CSP (`tauri.conf.json`) — o CSP não usa curinga de porta.

### Gerar o pacote instalável

```bash
cd frontend
npm run tauri:build
```

Os artefatos ficam em `frontend/src-tauri/target/release/bundle/` — neste ambiente foram gerados `.deb` (4,4 MiB), `.rpm` e `.AppImage` (80 MiB). O `.deb` declara como dependências `libwebkit2gtk-4.1-0`, `libgtk-3-0` e `libayatana-appindicator3-1`, e instala o ícone nos tamanhos 32/128/256.

## Segurança

- `capabilities/default.json` concede **zero** permissões de API nativa ao frontend.
- Toda ação sensível passa por comandos próprios em `lib.rs` (`window_show`, `window_hide`, `window_toggle`, `window_start_dragging`, `window_set_always_on_top`, `app_quit`) — o frontend apenas os solicita pelo nome.
- A janela **não abre portas**: ela apenas faz `fetch` de saída para o FastAPI em loopback (`127.0.0.1:8765` por padrão). Não há plugin HTTP do Tauri; o mesmo `services/api.js` funciona no WebView e no navegador.
- O CSP em `tauri.conf.json` restringe `connect-src` a `'self'`, `http://127.0.0.1:8765` e `http://localhost:8765`. O CORS do FastAPI (`CORS_ORIGIN_REGEX`) aceita somente loopback e as origens exatas `tauri://localhost` / `http://tauri.localhost`. Nunca use `*`; quem já tem `.env` antigo precisa atualizar a linha manualmente.
- Nenhuma API nativa de filesystem, shell, diálogo, HTTP ou notificação está habilitada.
- `npm audit --omit=dev` reporta **0 vulnerabilidades** em produção. Os avisos restantes são de dependências de desenvolvimento (esbuild/vite) e afetam apenas o servidor local de dev; nunca exponha a porta 5180 na rede.
- `skipTaskbar` está `false` para que a janela continue acessível via dock/Alt+Tab mesmo em ambientes sem bandeja. Mude para `true` em `tauri.conf.json` se o alvo tiver AppIndicator garantido.

## Limitações conhecidas do Linux / GNOME

1. **Clique no ícone da bandeja.** O Tauri 2 não emite `TrayIconEvent::Click` no Linux: o backend é AppIndicator (StatusNotifierItem), que entrega apenas o menu de contexto. O handler de clique existe em `lib.rs` e funciona em Windows/macOS; **no Linux, use o menu** (Abrir/Ocultar/Sair). Esta é a alternativa compatível recomendada pela limitação da plataforma.
2. **Extensão do shell.** Sem `ubuntu-appindicators` (GNOME) ou um painel compatível (COSMIC), o ícone pode não aparecer. A janela continua acessível pela dock porque `skipTaskbar: false`.
3. **Transparência.** `transparent: true` depende do WebKitGTK 4.1 e do compositor. Em X11/Mutter o glassmorphism é aplicado; em sessions Wayland sem compositor compatível, o fundo pode aparecer opaco. O conteúdo foi desenhado para continuar legível nesse caso.
4. **Sempre no topo.** `alwaysOnTop: true` depende do gerenciador de janelas. Alguns WMs honram apenas a intenção, outros ignoram. O comando `window_set_always_on_top` já está disponível para controle futuro.
5. **Sombra.** `shadow: true` é aplicado em Windows/macOS; no Linux a sombra visual vem do `box-shadow` do CSS.
6. **Posicionamento.** A janela é reposicionada no canto inferior direito da *work area* (descontando dock/barras) a cada abertura. Se o usuário a moveu e a ocultou, a reabertura reposiciona — o estado visual (conteúdo e estilo) é preservado porque o WebView não é recriado.

## Critérios de aceitação

| # | Critério | Status |
|---|---|---|
| 1 | Compila e inicia no Pop!_OS | Validado com `cargo check`, `npm run build` e `tauri dev` |
| 2 | Ícone na bandeja | Validado no X11 via DBus (`/org/ayatana/NotificationItem/...`) |
| 3 | Clique no ícone abre a janela | No Linux o AppIndicator entrega apenas o menu; itens testados via DBusMenu. Clique direto funciona em Windows/macOS |
| 4 | Janela arrastável | `onMouseDown` no cabeçalho chama o comando próprio `window_start_dragging` (sem exigir permissão de plugin) |
| 5 | Ocultar sem encerrar | `CloseRequested → prevent_close() → hide()` |
| 6 | Reabrir pela bandeja | Item `Abrir assistente` do menu |
| 7 | Menu permite sair | Item `Sair do aplicativo` → `app.exit(0)` |
| 8 | Sem instâncias duplicadas | Plugin `tauri-plugin-single-instance` |
| 9 | Conversa na janela com backend ligado | `/health` + `/history` na abertura; `/chat` no envio, com histórico recarregado sem duplicatas |
| 10 | Indicadores honestos | `conectando / online / offline` no badge; `offline` não depende do foco da janela |
| 11 | Falhas do modelo | 503 destacado na conversa, pergunta permanece no `/history`, campo limpo |
| 12 | Falha de rede | Texto digitado preservado e badge `offline` |
| 13 | Ferramentas | `TOOLS_ENABLED=true` exibe chips com `tool`, `ok` e `error_code` |
| 14 | Testes automatizados | `pytest`, `npm test` (api.js, hook e controles), `npm run build` e `cargo check` via `scripts/check.sh` |

### Validação manual obrigatória

1. `npm run dev` (5173) com backend ligado → conversa funciona no navegador.
2. `npm run tauri:dev` (5180) com backend ligado → mesma conversa na janela nativa (aqui aparecem problemas de CSP/CORS).
3. Reiniciar o backend → histórico persistido.
4. Parar o `llama-server` → 503 visível, pergunta no `/history`, campo limpo.
5. Parar o backend → badge `offline`, erro sem perder o texto digitado.
6. `TOOLS_ENABLED=true` → chips de ferramentas na resposta.
7. `npm run tauri:build` e `cargo check` → pacote gerado sem erros.

## Próxima etapa

Voz: push-to-talk, STT e TTS sob demanda, mantendo os componentes atuais e o backend local.
