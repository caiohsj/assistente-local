from types import SimpleNamespace

import pytest

from app import stt
from app.config import settings
from app.stt import SttUnavailableError


def wav():
    """Cabeçalho WAV mínimo (44 bytes) suficiente para a validação do endpoint."""
    return b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32


def fake_model(text="olá mundo"):
    def transcribe(_path, **_kwargs):
        segments = [SimpleNamespace(text=text)]
        return segments, SimpleNamespace()

    return SimpleNamespace(transcribe=transcribe)


def test_transcribe_endpoint_disabled(client):
    response = client.post(
        "/transcribe", content=wav(), headers={"Content-Type": "audio/wav"}
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Captura de voz desabilitada."


def test_transcribe_endpoint_returns_text(client, monkeypatch):
    monkeypatch.setattr(settings, "voice_enabled", True)
    monkeypatch.setattr(stt, "_load_model", lambda _settings: fake_model())

    response = client.post(
        "/transcribe", content=wav(), headers={"Content-Type": "audio/wav"}
    )
    assert response.status_code == 200
    assert response.json() == {"text": "olá mundo"}


def test_transcribe_endpoint_validates_payload(client, monkeypatch):
    monkeypatch.setattr(settings, "voice_enabled", True)

    assert client.post("/transcribe", content=b"").status_code == 400
    assert (
        client.post(
            "/transcribe", content=b"x", headers={"Content-Type": "text/plain"}
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/transcribe", content=b"RIFFxxxx", headers={"Content-Type": "audio/wav"}
        ).status_code
        == 400
    )
    monkeypatch.setattr(settings, "voice_max_audio_bytes", 2)
    assert (
        client.post("/transcribe", content=b"abcd", headers={"Content-Type": "audio/wav"}).status_code
        == 413
    )


def test_transcribe_endpoint_reports_missing_dependency(client, monkeypatch):
    monkeypatch.setattr(settings, "voice_enabled", True)

    def fail(_settings):
        raise SttUnavailableError("faster-whisper não está instalado.")

    monkeypatch.setattr(stt, "_load_model", fail)
    response = client.post(
        "/transcribe", content=wav(), headers={"Content-Type": "audio/wav"}
    )
    assert response.status_code == 503
    assert "faster-whisper" in response.json()["detail"]


def test_health_exposes_stt_state(client, monkeypatch):
    voice = client.get("/health").json()["voice"]
    assert voice["enabled"] is False
    assert "stt_available" in voice
    assert "stt_model" in voice

    monkeypatch.setattr(settings, "voice_enabled", True)
    assert client.get("/health").json()["voice"]["enabled"] is True


def test_transcribe_joins_and_normalizes_segments(monkeypatch):
    def transcribe(_path, **_kwargs):
        return [SimpleNamespace(text="  olá "), SimpleNamespace(text="mundo!  ")], None

    monkeypatch.setattr(stt, "_load_model", lambda _settings: SimpleNamespace(transcribe=transcribe))
    assert stt.transcribe(b"RIFF", settings) == "olá mundo!"


def test_transcribe_rejects_empty_audio(monkeypatch):
    with pytest.raises(ValueError):
        stt.transcribe(b"", settings)
