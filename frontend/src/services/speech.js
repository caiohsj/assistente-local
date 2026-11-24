/**
 * Camada fina sobre a Web Speech API do navegador/WebView.
 *
 * Nenhum áudio é enviado ao backend: a transcrição acontece no provedor do
 * navegador. Guardar a criação do reconhecedor aqui mantém os hooks testáveis
 * com um mock simples e concentra as diferenças `webkitSpeechRecognition`.
 */

export function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechSupported() {
  return Boolean(getSpeechRecognition());
}

/** Remove acentos e caixa para comparar a palavra de ativação. */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** verdadeiro quando a frase contém a wake word como palavra inteira. */
export function containsWakeWord(text, wakeWord = "mestre") {
  const needle = normalizeText(wakeWord);
  if (!needle) return false;
  // Espaços nas bordas garantem palavra inteira e aceitam wake words de
  // mais de uma palavra, como "ok mestre".
  return ` ${normalizeText(text)} `.includes(` ${needle} `);
}

/**
 * Cria um reconhecedor já configurado. Retorna `null` quando o navegador não
 * oferece a API — chamadores devem tratar isso como "recurso indisponível".
 */
export function createRecognizer({ language = "pt-BR", continuous = false, interimResults = true } = {}) {
  const Recognition = getSpeechRecognition();
  if (!Recognition) return null;

  const recognizer = new Recognition();
  recognizer.lang = language;
  recognizer.continuous = continuous;
  recognizer.interimResults = interimResults;
  return recognizer;
}

/**
 * Erros que não exigem intervenção: em escuta contínua são comuns após
 * silêncio ou interrupção do próprio navegador e apenas reiniciam a sessão.
 */
export function isRecoverableSpeechError(event) {
  const code = event?.error || event;
  return code === "no-speech" || code === "aborted";
}

/** Mensagens amigáveis para os erros mais comuns da Web Speech API. */
export function speechErrorMessage(error) {
  switch (error?.error || error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permissão de microfone negada. Libere o acesso e tente de novo.";
    case "no-speech":
      return "Não ouvi nada. Tente falar mais perto do microfone.";
    case "audio-capture":
      return "Nenhum microfone disponível neste dispositivo.";
    case "network":
      return "O serviço de transcrição do navegador está indisponível.";
    case "aborted":
      return null;
    default:
      return "Não foi possível capturar sua voz. Tente novamente.";
  }
}
