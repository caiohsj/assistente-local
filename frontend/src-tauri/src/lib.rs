//! Camada nativa do MVP Desktop.
//!
//! Responsabilidades desta camada:
//!   - manter o ícone na bandeja do sistema e seu menu de contexto;
//!   - controlar visibilidade/foco/posição da janela flutuante;
//!   - impedir que o botão de fechar encerre o processo;
//!   - garantir uma única instância do aplicativo;
//!   - registrar o atalho global que abre o Mestre pedindo captura de voz.
//!
//! Nenhuma funcionalidade de IA, áudio, rede ou sistema de arquivos é exposta aqui.
//! O áudio permanece no WebView (Web Speech API); o Rust apenas sinaliza o pedido.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

mod linux_media;

const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "mestre-tray";
const VOICE_REQUEST_EVENT: &str = "mestre://voice-request";
const VOICE_SHORTCUT: &str = "CommandOrControl+Shift+M";
const MARGIN_LOGICAL_PX: f64 = 24.0;

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Coloca a janela no canto inferior direito da área útil do monitor,
/// respeitando dock/base de estado e os limites da tela.
fn position_near_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let margin = (MARGIN_LOGICAL_PX * scale).round() as i32;
    let work = monitor.work_area();
    let size = window
        .outer_size()
        .unwrap_or_else(|_| tauri::PhysicalSize::new(420, 600));

    let width = size.width as i32;
    let height = size.height as i32;

    let x = (work.position.x + work.size.width as i32 - width - margin)
        .max(work.position.x + margin);
    let y = (work.position.y + work.size.height as i32 - height - margin)
        .max(work.position.y + margin);

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_window(window: &WebviewWindow) {
    position_near_bottom_right(window);
    let _ = window.show();
    let _ = window.set_focus();
}

/// Abre a janela e sinaliza ao frontend para iniciar a captura de voz.
/// O frontend decide se o recurso está habilitado (env + /health) e qual o modo.
fn request_voice_capture(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        show_window(&window);
    }
    let _ = app.emit(VOICE_REQUEST_EVENT, ());
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        Ok(false) => show_window(&window),
        Err(_) => show_window(&window),
    }
}

// ---------------------------------------------------------------------------
// Comandos IPC. O frontend não recebe nenhuma permissão de API nativa: ele
// apenas solicita estas ações explícitas, definidas aqui no Rust.
// ---------------------------------------------------------------------------

#[tauri::command]
fn window_show(app: AppHandle) {
    if let Some(window) = main_window(&app) {
        show_window(&window);
    }
}

#[tauri::command]
fn window_hide(app: AppHandle) {
    if let Some(window) = main_window(&app) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn window_toggle(app: AppHandle) {
    toggle_window(&app);
}

#[tauri::command]
fn window_start_dragging(app: AppHandle) {
    if let Some(window) = main_window(&app) {
        let _ = window.start_dragging();
    }
}

#[tauri::command]
fn window_set_always_on_top(app: AppHandle, enabled: bool) {
    if let Some(window) = main_window(&app) {
        let _ = window.set_always_on_top(enabled);
    }
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        // Atalho global: abre o Mestre já pedindo captura de voz. Registrado
        // sempre; o frontend é quem aplica a válvula da variável de ambiente.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(VOICE_SHORTCUT)
                .expect("atalho global inválido")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        request_voice_capture(&app);
                    }
                })
                .build(),
        )
        // Se um segundo processo for iniciado, ele apenas traz a janela
        // existente para frente e encerra, sem criar uma segunda instância.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = main_window(app) {
                show_window(&window);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            window_show,
            window_hide,
            window_toggle,
            window_start_dragging,
            window_set_always_on_top,
            app_quit
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(WINDOW_LABEL)
                .expect("a janela 'main' precisa existir no tauri.conf.json");
            #[cfg(target_os = "linux")]
            linux_media::enable_media_capture(&window);
            position_near_bottom_right(&window);

            // Alguns gerenciadores de janela (GNOME/Mutter, por exemplo)
            // reposicionam a janela no momento em que ela é mapeada. Reaplicar
            // a posição logo após o mapeamento garante o canto inferior direito.
            let deferred = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let handle = deferred.clone();
                let _ = deferred.run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window(WINDOW_LABEL) {
                        position_near_bottom_right(&window);
                    }
                });
            });

            // No Linux, o trayIcon pode não aparecer sem um menu associado.
            let open = MenuItem::with_id(app, "open", "Abrir Mestre", true, None::<&str>)?;
            let voice = MenuItem::with_id(app, "voice", "Falar com Mestre", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Ocultar Mestre", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair do aplicativo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &voice, &hide, &quit])?;

            let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

            let tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .menu(&menu)
                .tooltip("Mestre")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = main_window(app) {
                            show_window(&window);
                        }
                    }
                    "voice" => request_voice_capture(app),
                    "hide" => {
                        if let Some(window) = main_window(app) {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Limitação conhecida: em Linux (AppIndicator) o Tauri 2 não
                    // emite eventos de clique, apenas entrega o menu de contexto.
                    // Este handler mantém o clique esquerdo funcional em
                    // Windows/macOS, onde o evento é suportado.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Mantém o ícone vivo durante todo o ciclo do aplicativo.
            app.manage(tray);

            // Fechar a janela apenas a oculta: o processo permanece na bandeja.
            let close_handler = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_handler.hide();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o Mestre");
}
