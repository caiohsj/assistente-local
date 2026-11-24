"""Transcrição local de áudio com faster-whisper.

O modelo é carregado sob demanda (o download acontece na primeira transcrição)
e mantido em memória. Nenhum áudio sai da máquina: o WebView envia um WAV
curto para `/transcribe` e recebe apenas o texto de volta.
"""

import logging
import os
import tempfile
import threading

logger = logging.getLogger(__name__)

_model = None
_model_key = None
_lock = threading.Lock()


class SttUnavailableError(RuntimeError):
    """faster-whisper não está instalado ou o modelo não pôde ser carregado."""


def stt_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except ImportError:
        return False


def _load_model(settings):
    global _model, _model_key
    key = (settings.voice_stt_model, settings.voice_stt_device, settings.voice_stt_compute_type)
    with _lock:
        if _model is not None and _model_key == key:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise SttUnavailableError(
                "faster-whisper não está instalado. Instale requirements.txt."
            ) from exc

        logger.info(
            "Carregando modelo de voz local: %s (%s/%s)",
            settings.voice_stt_model,
            settings.voice_stt_device,
            settings.voice_stt_compute_type,
        )
        try:
            model = WhisperModel(
                settings.voice_stt_model,
                device=settings.voice_stt_device,
                compute_type=settings.voice_stt_compute_type,
            )
        except Exception as exc:
            logger.exception("Falha ao carregar o modelo de voz")
            raise SttUnavailableError("Não foi possível carregar o modelo de voz local.") from exc

        _model = model
        _model_key = key
        return _model


def reset_model() -> None:
    """Útil em testes e após troca de configuração em runtime."""
    global _model, _model_key
    with _lock:
        _model = None
        _model_key = None


def transcribe(audio: bytes, settings, language: str | None = None) -> str:
    """Recebe WAV/WebM/Opus e devolve o texto transcrito."""
    if not audio:
        raise ValueError("Áudio vazio.")
    if len(audio) > settings.voice_max_audio_bytes:
        raise ValueError("Áudio muito grande.")

    model = _load_model(settings)
    lang = language or settings.voice_stt_language
    if lang == "auto":
        lang = None

    suffix = ".wav"
    fd, path = tempfile.mkstemp(prefix="mestre-voice-", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(audio)
        segments, _info = model.transcribe(
            path,
            language=lang,
            beam_size=1,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        return " ".join(text.split())
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
