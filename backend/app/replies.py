"""Respostas determinísticas para perguntas factuais simples.

O modelo local tende a transformar o resultado de uma ferramenta em relatório,
mesmo com regras no prompt (principalmente quando o histórico tem respostas
longas). Para os casos objetivos abaixo, montamos a frase a partir do payload
da própria ferramenta. Se a pergunta não se encaixa, devolvemos ``None`` e o
texto do modelo continua valendo.
"""

import unicodedata

UNITS = (
    "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"
)
TEENS = (
    "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
    "dezessete", "dezoito", "dezenove",
)
TENS = ("vinte", "trinta", "quarenta", "cinquenta")


def normalize_question(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    ascii_text = decomposed.encode("ascii", "ignore").decode("ascii").casefold()
    for mark in "?!,.:;":
        ascii_text = ascii_text.replace(mark, " ")
    return " ".join(ascii_text.split())


def _words(number: int) -> str:
    number = max(0, min(59, int(number)))
    if number < 10:
        return UNITS[number]
    if number < 20:
        return TEENS[number - 10]
    tens = TENS[number // 10 - 2]
    remainder = number % 10
    return f"{tens} e {UNITS[remainder]}" if remainder else tens


def _percent(value) -> str:
    try:
        return f"{float(value):.1f}".replace(".", ",")
    except (TypeError, ValueError):
        return "0,0"


def _time_reply(question: str, result: dict) -> str | None:
    words = question.split()
    blocked = {
        "data", "dia", "semana", "utc", "fuso", "pais", "cidade", "toquio",
        "york", "som", "clima", "previsao", "evento", "alarme",
    }
    if not any(word in question for word in ("hora", "horas", "horario")):
        return None
    if len(words) > 7 or blocked.intersection(words):
        return None
    clock = str(result.get("time_pt_br") or "")
    parts = clock.split(":")
    if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None
    hour, minute = int(parts[0]), int(parts[1])
    hour_label = "uma hora" if hour == 1 else f"{_words(hour)} horas"
    if minute == 0:
        return f"São {hour_label} em ponto."
    minute_label = "um minuto" if minute == 1 else f"{_words(minute)} minutos"
    return f"São {hour_label} e {minute_label}."


def _system_reply(question: str, result: dict) -> str | None:
    if len(question.split()) > 10:
        return None
    memory = result.get("memory") or {}
    cpu = result.get("cpu") or {}
    devices = (result.get("gpu") or {}).get("devices") or []
    asks_memory = "memoria" in question
    asks_cpu = "cpu" in question or "processador" in question
    asks_gpu = "gpu" in question or "placa" in question
    if not (asks_memory or asks_cpu or asks_gpu):
        return None

    parts: list[str] = []
    if asks_gpu:
        if not devices:
            return None  # sem dado de GPU, o modelo explica a ausência
        parts.append(f"GPU em {_percent(devices[0].get('utilization_percent'))}%")
    if asks_cpu:
        parts.append(f"CPU em {_percent(cpu.get('usage_percent'))}%")
    if asks_memory:
        parts.append(f"memória em {_percent(memory.get('percent'))}%")

    if len(parts) == 1:
        if asks_memory:
            return f"O uso de memória está em {_percent(memory.get('percent'))}%."
        if asks_cpu:
            return f"O uso de CPU está em {_percent(cpu.get('usage_percent'))}%."
        return f"O uso da GPU está em {_percent(devices[0].get('utilization_percent'))}%."
    return " e ".join(parts) + "."


def _disk_reply(question: str, result: dict) -> str | None:
    if "disco" not in question or len(question.split()) > 10:
        return None
    if any(word in question for word in ("memoria", "cpu", "gpu", "processo")):
        return None
    mounts = result.get("mounts") or []
    if not isinstance(mounts, list) or not mounts:
        return None
    root = next((item for item in mounts if item.get("mountpoint") == "/"), mounts[0])
    if "total" in question:
        return f"O disco tem {_percent(root.get('total_gb')).replace(',0', '')} GB no total."
    if "usado" in question or "ocupado" in question:
        return f"O disco está usando {_percent(root.get('percent'))}%."
    return f"Há {_percent(root.get('free_gb')).replace(',0', '')} GB livres."


def _open_reply(question: str, name: str, payload: dict) -> str | None:
    if len(question) > 90:
        return None
    if "abra" not in question and "abro" not in question and "abrir" not in question:
        return None
    if any(word in question for word in ("como", "explique", "quais", "lista", "pode me dizer")):
        return None
    result = payload.get("result") or {}
    if name == "open_app":
        app = str(result.get("app") or "o aplicativo")
        if app != "o aplicativo":
            app = app[:1].upper() + app[1:]
        if payload.get("ok"):
            return f"Pronto, abri {app}."
        code = (payload.get("error") or {}).get("code")
        if code == "not_found":
            return f"Não encontrei {app} no sistema."
        if code == "forbidden_target":
            return f"{app} está bloqueado pela configuração."
        return f"Não consegui abrir {app}."
    if name == "open_url":
        host = str(result.get("host") or "o site")
        return f"Pronto, abri o site {host}." if payload.get("ok") else "Não consegui abrir o site."
    return None


def short_reply_for(question: str | None, payloads: dict[str, dict]) -> str | None:
    """Devolve a frase curta, ou ``None`` quando não há caso conhecido."""
    if not question or len(payloads) != 1:
        return None
    question = normalize_question(question)
    if not question:
        return None
    name, payload = next(iter(payloads.items()))
    result = payload.get("result") or {}
    if name in ("get_current_datetime", "get_system_info", "get_disk_usage") and not payload.get("ok"):
        return None

    if name == "get_current_datetime":
        return _time_reply(question, result)
    if name == "get_system_info":
        return _system_reply(question, result)
    if name == "get_disk_usage":
        return _disk_reply(question, result)
    if name in ("open_app", "open_url"):
        return _open_reply(question, name, payload)
    return None
