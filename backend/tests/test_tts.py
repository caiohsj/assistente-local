import pytest

from app import main, tts
from app.config import settings
from app.tts import TtsUnavailableError


class FakeVoice:
    def __init__(self):
        self.calls = []

    def synthesize_wav(self, text, wav_file, syn_config=None):
        self.calls.append((text, syn_config))
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\x00\x00" * 10)


def fake_wav():
    return b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32


def enable(monkeypatch):
    monkeypatch.setattr(settings, "voice_enabled", True)
    monkeypatch.setattr(settings, "voice_tts_enabled", True)


def test_speak_endpoint_disabled(client):
    assert client.post("/speak", json={"text": "oi"}).status_code == 403


def test_speak_endpoint_requires_capture_enabled(client, monkeypatch):
    monkeypatch.setattr(settings, "voice_tts_enabled", True)
    assert client.post("/speak", json={"text": "oi"}).status_code == 403


def test_speak_endpoint_returns_wav(client, monkeypatch):
    enable(monkeypatch)
    monkeypatch.setattr(main, "synthesize", lambda _text, _settings: fake_wav())

    response = client.post("/speak", json={"text": "  pronto  "})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.headers["cache-control"] == "no-store"
    assert response.content == fake_wav()


def test_speak_endpoint_validates_text(client, monkeypatch):
    enable(monkeypatch)

    assert client.post("/speak", json={"text": "   "}).status_code == 422
    assert client.post("/speak", json={"text": "x" * 2001}).status_code == 422

    def too_long(_text, _settings):
        raise ValueError("Texto muito longo para síntese.")

    monkeypatch.setattr(main, "synthesize", too_long)
    assert client.post("/speak", json={"text": "x" * 300}).status_code == 400


def test_speak_endpoint_reports_missing_voice(client, monkeypatch):
    enable(monkeypatch)

    def fail(_text, _settings):
        raise TtsUnavailableError("Não foi possível carregar a voz local.")

    monkeypatch.setattr(main, "synthesize", fail)
    response = client.post("/speak", json={"text": "oi"})
    assert response.status_code == 503
    assert "voz local" in response.json()["detail"]


def test_health_exposes_tts_state(client, monkeypatch):
    voice = client.get("/health").json()["voice"]
    assert voice["tts_enabled"] is False
    assert voice["tts_available"] in (True, False)
    assert voice["tts_voice"] == "pt_BR-faber-medium"
    assert voice["tts_max_chars"] == 240
    assert "tts_voice_present" in voice

    monkeypatch.setattr(settings, "voice_tts_enabled", True)
    assert client.get("/health").json()["voice"]["tts_enabled"] is True


def test_synthesize_uses_local_voice(monkeypatch):
    voice = FakeVoice()
    monkeypatch.setattr(tts, "_load_voice", lambda _settings: voice)

    audio = tts.synthesize("  olá mundo  ", settings)
    assert audio[:4] == b"RIFF"
    assert audio[8:12] == b"WAVE"
    assert voice.calls[0][0] == "olá mundo"
    assert voice.calls[0][1] is not None


def test_synthesize_rejects_empty_and_long_text(monkeypatch):
    monkeypatch.setattr(tts, "_load_voice", lambda _settings: FakeVoice())

    with pytest.raises(ValueError):
        tts.synthesize("   ", settings)
    with pytest.raises(ValueError):
        tts.synthesize("x" * 241, settings)
