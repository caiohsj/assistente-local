// A aplicação é implementada em lib.rs para permitir reutilização em alvos
// futuros (por exemplo, versão mobile). Este binário é apenas o ponto de entrada.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    assistente_local_lib::run()
}
