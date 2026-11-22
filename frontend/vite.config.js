import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O Tauri define VITE_PORT para usar uma porta isolada de outros servidores
// de dev que possam estar rodando no mesmo diretório ( npm run dev ).
const port = Number(process.env.VITE_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  // O Tauri abre o navegador por conta própria; manter o terminal limpo
  // e a porta fixa evita falsos positivos na detecção do servidor de dev.
  clearScreen: false,
  server: { host: "127.0.0.1", port, strictPort: true }
});
