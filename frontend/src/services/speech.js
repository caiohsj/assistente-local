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

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Aceita variações pequenas do ASR ("mestri", "mestres"). */
function matchesToken(token, target) {
  if (!token || !target) return false;
  if (token === target) return true;
  if (target.length < 4 || Math.abs(token.length - target.length) > 1) return false;
  return editDistance(token, target) <= 1;
}

/** verdadeiro quando a frase contém a wake word como palavra inteira. */
export function containsWakeWord(text, wakeWord = "mestre") {
  const needle = normalizeText(wakeWord);
  if (!needle) return false;
  const words = normalizeText(text).split(" ").filter(Boolean);
  const target = needle.split(" ");
  if (target.length === 1) {
    return words.some((word) => matchesToken(word, target[0]));
  }
  // Wake words de várias palavras precisam aparecer em sequência.
  for (let index = 0; index <= words.length - target.length; index += 1) {
    if (target.every((part, offset) => matchesToken(words[index + offset], part))) {
      return true;
    }
  }
  return false;
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
