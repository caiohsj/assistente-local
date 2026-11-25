from app.replies import normalize_question, short_reply_for


def test_hora_em_palavras():
    payloads = {
        "get_current_datetime": {
            "ok": True,
            "result": {"time_pt_br": "15:15:00", "date_pt_br": "24/11/2026"},
        }
    }
    assert short_reply_for("Que horas são?", payloads) == "São quinze horas e quinze minutos."
    assert short_reply_for("Que horas são...", payloads) == "São quinze horas e quinze minutos."
    payloads["get_current_datetime"]["result"]["time_pt_br"] = "14:00:00"
    assert short_reply_for("Que horas são?", payloads) == "São quatorze horas em ponto."
    payloads["get_current_datetime"]["result"]["time_pt_br"] = "01:01:00"
    assert short_reply_for("Que horas são?", payloads) == "São uma hora e um minuto."


def test_memoria_cpu_e_gpu():
    payloads = {
        "get_system_info": {
            "ok": True,
            "result": {
                "cpu": {"usage_percent": 8.25},
                "memory": {"percent": 62.34},
                "gpu": {"devices": [{"utilization_percent": 37.0}]},
            },
        }
    }
    assert short_reply_for("Qual o uso de memória?", payloads) == "O uso de memória está em 62,3%."
    assert short_reply_for("Qual o uso de CPU?", payloads) == "O uso de CPU está em 8,2%."
    assert short_reply_for("Qual o uso de CPU e memória?", payloads) == "CPU em 8,2% e memória em 62,3%."
    assert short_reply_for("Qual o uso de GPU e memória?", payloads) == "GPU em 37,0% e memória em 62,3%."


def test_disco_livre():
    payloads = {
        "get_disk_usage": {
            "ok": True,
            "result": {
                "mounts": [
                    {"mountpoint": "/", "free_gb": 120.4, "total_gb": 500.0, "percent": 75.9}
                ]
            },
        }
    }
    assert short_reply_for("Quanto disco livre?", payloads) == "Há 120,4 GB livres."
    assert short_reply_for("Qual o total do disco?", payloads) == "O disco tem 500 GB no total."


def test_abertura_de_app_e_site():
    ok = {"ok": True, "result": {"app": "Discord"}}
    assert short_reply_for("Abra o Discord", {"open_app": ok}) == "Pronto, abri Discord."
    falha = {"ok": False, "error": {"code": "not_found", "message": "x"}}
    assert short_reply_for("Abra o Discord", {"open_app": falha}) == "Não encontrei o aplicativo no sistema."
    site = {"ok": True, "result": {"host": "example.com"}}
    assert short_reply_for("Abra o site https://example.com", {"open_url": site}) == "Pronto, abri o site example.com."


def test_sem_resposta_curta_para_casos_complexos():
    assert short_reply_for(None, {}) is None
    assert short_reply_for("Explique como instalar o Telegram passo a passo", {"open_app": {"ok": False}}) is None
    assert short_reply_for("Que horas são em Tóquio?", {
        "get_current_datetime": {"ok": True, "result": {"time_pt_br": "15:15:00"}}
    }) is None
    # Falha na ferramenta de dados: quem responde é o modelo.
    assert short_reply_for("Que horas são?", {
        "get_current_datetime": {"ok": False, "error": {"code": "unavailable"}}
    }) is None
    # Duas ferramentas na mesma interação não têm resposta determinística.
    assert short_reply_for("Que horas são e como está a memória?", {
        "get_current_datetime": {"ok": True, "result": {"time_pt_br": "15:15:00"}},
        "get_system_info": {"ok": True, "result": {"memory": {"percent": 40}}},
    }) is None
    assert normalize_question("  Que horas são...?  ") == "que horas sao"
