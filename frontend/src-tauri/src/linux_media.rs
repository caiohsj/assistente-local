//! Habilita captura de microfone no WebView WebKitGTK (Tauri no Linux).
//!
//! O WebKitGTK desliga `enable-media-stream` por padrão e nega qualquer
//! `UserMediaPermissionRequest` não respondido. O Tauri/wry não conecta esse
//! sinal, então sem este módulo `getUserMedia` falha com `NotAllowedError`.
//!
//! Nada aqui é compilado fora do Linux; a função de origem confiável é pura
//! para poder ser testada em qualquer plataforma.

const PROD_ORIGINS: [&str; 2] = ["tauri://localhost", "http://tauri.localhost"];

#[cfg(debug_assertions)]
const DEV_ORIGINS: [&str; 2] = ["http://127.0.0.1:5180", "http://localhost:5180"];

/// Compara a origem exata (scheme + host + porta) do documento atual.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn is_trusted_media_origin(uri: &str) -> bool {
    let origin = uri.split('/').take(3).collect::<Vec<_>>().join("/");
    if PROD_ORIGINS.contains(&origin.as_str()) {
        return true;
    }
    #[cfg(debug_assertions)]
    if DEV_ORIGINS.contains(&origin.as_str()) {
        return true;
    }
    false
}

#[cfg(target_os = "linux")]
pub fn enable_media_capture(window: &tauri::WebviewWindow) {
    use webkit2gtk::{
        glib::Cast, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    let _ = window.with_webview(|platform| {
        let webview = platform.inner();

        if let Some(settings) = WebViewExt::settings(&webview) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_enable_webrtc(true);
        }

        // Deny-by-default: só a origem do próprio app pode usar microfone/câmera.
        webview.connect_permission_request(|wv, request| {
            let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                return false; // mantém o tratamento padrão para outros tipos
            };
            let uri = wv.uri().map(|value| value.to_string()).unwrap_or_default();
            // Somente microfone: câmera fica explicitamente negada.
            if media.is_for_audio_device() && is_trusted_media_origin(&uri) {
                media.allow();
            } else {
                media.deny();
            }
            true // resposta dada: não deixa o WebKit negar por omissão
        });
    });
}

#[cfg(test)]
mod tests {
    use super::is_trusted_media_origin;

    #[test]
    fn aceita_apenas_as_origens_do_app() {
        assert!(is_trusted_media_origin("tauri://localhost/"));
        assert!(is_trusted_media_origin("http://tauri.localhost/"));
        #[cfg(debug_assertions)]
        {
            assert!(is_trusted_media_origin("http://127.0.0.1:5180/"));
            assert!(is_trusted_media_origin("http://localhost:5180/index.html"));
        }
    }

    #[test]
    fn rejeita_origens_parecidas() {
        assert!(!is_trusted_media_origin("tauri://localhost.evil.com/"));
        assert!(!is_trusted_media_origin("http://tauri.localhost.evil.com/"));
        assert!(!is_trusted_media_origin("https://example.com/"));
        assert!(!is_trusted_media_origin(""));
        #[cfg(debug_assertions)]
        assert!(!is_trusted_media_origin("http://127.0.0.1:5181/"));
    }
}
