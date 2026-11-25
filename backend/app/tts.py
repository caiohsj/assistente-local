"""Síntese local de voz com Piper.

O modelo é carregado sob demanda (a voz é baixada no primeiro uso) e mantido
em memória, como em ``stt.py``. O WebView pede `POST /speak` e recebe um WAV:
nenhum texto ou áudio sai da máquina.
"""

import io
import logging
import threading
import wave
from pathlib import Path

logger = logging.getLogger(__name__)

_voice = None
_voice_key = None
_lock = threading.Lock()


class TtsUnavailableError(RuntimeError):
    """piper-tts não está instalado ou a voz não pôde ser carregada."""


def tts_available() -> bool:
    try:
        import piper  # noqa: F401

        return True
    except Exception:
        # Biblioteca nativa ausente também pode levantar OSError, não só
        # ImportError — /health não pode quebrar por causa disso.
        return False


def voice_path(settings) -> Path:
    return Path(settings.voice_tts_data_dir) / f"{settings.voice_tts_voice}.onnx"


def _config_path(settings) -> Path:
    return voice_path(settings).with_suffix(".onnx.json")


def voice_present(settings) -> bool:
    """Checa os arquivos sem carregar o modelo (rápido o bastante para /health)."""
    return voice_path(settings).is_file() and _config_path(settings).is_file()


def _load_voice(settings):
    global _voice, _voice_key
    key = (settings.voice_tts_voice, str(settings.voice_tts_data_dir))
    with _lock:
        if _voice is not None and _voice_key == key:
            return _voice
        try:
            from piper import PiperVoice
        except ImportError as exc:
            raise TtsUnavailableError(
                "piper-tts não está instalado. Instale requirements.txt."
            ) from exc

        path = voice_path(settings)
        if not voice_present(settings):
            logger.info("Baixando voz local: %s", settings.voice_tts_voice)
            try:
                from piper.download_voices import download_voice

                path.parent.mkdir(parents=True, exist_ok=True)
                download_voice(settings.voice_tts_voice, path.parent)
            except Exception as exc:
                logger.exception("Falha ao baixar a voz local")
                raise TtsUnavailableError(
                    "Não foi possível baixar a voz local para síntese."
                ) from exc

        try:
            loaded = PiperVoice.load(str(path))
        except Exception as exc:
            logger.exception("Falha ao carregar a voz local")
            raise TtsUnavailableError("Não foi possível carregar a voz local.") from exc

        _voice = loaded
        _voice_key = key
        return loaded


def reset_voice() -> None:
    """Útil em testes e após troca de configuração em runtime."""
    global _voice, _voice_key
    with _lock:
        _voice = None
        _voice_key = None


def synthesize(text: str, settings) -> bytes:
    """Recebe texto simples e devolve um WAV PCM com a voz local."""
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Texto vazio.")
    if len(cleaned) > settings.voice_tts_max_chars:
        raise ValueError("Texto muito longo para síntese.")

    voice = _load_voice(settings)

    config = None
    try:
        from piper import SynthesisConfig

        config = SynthesisConfig(length_scale=settings.voice_tts_length_scale)
    except (ImportError, TypeError):
        # Versões antigas não expõem SynthesisConfig: usa os padrões da voz.
        logger.debug("SynthesisConfig indisponível; usando padrões da voz")

    buffer = io.BytesIO()
    try:
        with wave.open(buffer, "wb") as wav_file:
            if config is None:
                voice.synthesize_wav(cleaned, wav_file)
            else:
                voice.synthesize_wav(cleaned, wav_file, syn_config=config)
    except TtsUnavailableError:
        raise
    except Exception as exc:
        logger.exception("Falha ao sintetizar a resposta")
        raise TtsUnavailableError("Falha ao gerar o áudio da resposta.") from exc

    return buffer.getvalue()
