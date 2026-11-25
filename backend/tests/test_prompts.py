from app.prompts import BASE_PROMPT, NO_TOOLS_PROMPT, TOOLS_PROMPT, build_system_prompt


def test_prompt_pede_respostas_curta_e_simples_sem_markdown():
    assert "uma única frase curta" in BASE_PROMPT
    assert "Não use Markdown" in BASE_PROMPT
    assert "formatação" in BASE_PROMPT


def test_prompt_de_ferramentas_traz_exemplos_de_perguntas_factuais():
    prompt = build_system_prompt(True)
    assert TOOLS_PROMPT.strip() in prompt
    assert "São três horas e quinze minutos." in prompt
    assert "O uso de memória está em 40%." in prompt
    assert "não transforme uma resposta simples em relatório" in prompt.lower()


def test_prompt_sem_ferramentas_nao_inclui_regras_de_ferramentas():
    prompt = build_system_prompt(False)
    assert NO_TOOLS_PROMPT.strip() in prompt
    assert TOOLS_PROMPT.strip() not in prompt
    assert "São três horas e quinze minutos." not in prompt
