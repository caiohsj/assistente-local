# MVP Desktop — Assistente Local

Janela flutuante residente com ícone na bandeja do sistema, construída com **Tauri 2 + React + Vite**, sem alterar o backend Python e sem introduzir IA, áudio ou rede nesta etapa.

## O que este MVP faz

- Inicia com uma janela sem bordas, escura, translúcida e sempre no topo, posicionada no canto inferior direito da área útil do monitor.
- Mantém um ícone na bandeja do sistema com o menu **Abrir assistente / Ocultar assistente / Sair do aplicativo**.
- O botão `×` da janela **oculta** a janela; o processo permanece residente. O encerramento real só acontece em **Sair**.
- Impede uma segunda instância: abrir o aplicativo novamente traz a janela existente para frente.
- A janela pode ser arrastada pelo cabeçalho e redimensionada entre 340×460 e 760×900 px.
- A interface funciona **sem o backend Python ligado** — nenhuma chamada `/health`, `/history` ou `/chat` é feita.

Fora do escopo desta etapa: conversa, STT/TTS, microfone, chamadas ao FastAPI/llama.cpp, ferramentas do sistema e notificações.

## Estrutura adicionada

```
frontend/
├── src/
│   ├── components/Assistant/
│   │   ├── AssistantWindow.jsx   # composição da janela e estados do mascote
│   │   ├── AssistantHeader.jsx   # nome, estado e botões ocultar/fechar
│   │   ├── AssistantMascot.jsx   # mascote SVG original (idle/hover/active)
│   │   ├── AssistantStatus.jsx   # indicador de disponibilidade
│   │   └── AssistantControls.jsx # campo/microfone/envio apenas visuais
│   ├── hooks/useWindowControls.js# invoke() dos comandos nativos
│   ├── services/api.js           # cliente FastAPI preservado para etapa futura
│   ├── styles/assistant.css      # identidade visual glassmorphism
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

Os botões de janela não fazem nada fora do Tauri; o rodapé mostra `pré-visualização`.

### Aplicativo desktop (com tray e janela nativa)

```bash
cd frontend
npm install
npm run tauri:dev
```

O comando inicia o Vite na porta **5180** (isolada por `VITE_PORT`, evitando colisão com o `npm run dev` comum na 5173) e abre a janela nativa. O backend Python **não** precisa estar ligado.

### Gerar o pacote instalável

```bash
cd frontend
npm run tauri:build
```

Os artefatos ficam em `frontend/src-tauri/target/release/bundle/` — neste ambiente foram gerados `.deb` (4,4 MiB), `.rpm` e `.AppImage` (80 MiB). O `.deb` declara como dependências `libwebkit2gtk-4.1-0`, `libgtk-3-0` e `libayatana-appindicator3-1`, e instala o ícone nos tamanhos 32/128/256.

## Segurança

- `capabilities/default.json` concede **zero** permissões de API nativa ao frontend.
- Toda ação sensível passa por comandos próprios em `lib.rs` (`window_show`, `window_hide`, `window_toggle`, `window_start_dragging`, `window_set_always_on_top`, `app_quit`) — o frontend apenas os solicita pelo nome.
- Nenhuma porta de rede é aberta; o cliente FastAPI em `services/api.js` está inativo.
- Nenhuma API de filesystem, shell, diálogo, HTTP ou notificação está habilitada.
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
| 9 | Funciona sem backend | Nenhuma requisição de rede no MVP |
| 10 | Arquitetura preparada para voz/IA | Componentes isolados + `services/api.js` preservado |

## Próxima etapa

Ligar `AssistantControls` ao `services/api.js`, adicionando estado de conversa, stream de resposta e, depois, captura de voz — sem reestruturar os componentes visuais.
