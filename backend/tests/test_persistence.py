from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_completion


def test_history_survives_new_app_instance(client, fake_llm):
    fake_llm.completions.responses.append(make_completion("persistiu"))
    assert client.post("/chat", json={"message": "guarde isto"}).status_code == 200

    # Uma nova instância do app sobre o mesmo SQLite deve ver o histórico.
    with TestClient(app) as second_client:
        messages = second_client.get("/history").json()["messages"]
        assert [item["content"] for item in messages] == ["guarde isto", "persistiu"]
        assert [item["role"] for item in messages] == ["user", "assistant"]
