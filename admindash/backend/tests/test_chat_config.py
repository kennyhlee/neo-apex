from app.config import Settings


def test_chat_defaults():
    s = Settings()
    assert s.chat_model == "anthropic:claude-haiku-4-5-20251001"
    assert s.chat_max_tokens == 1024
    assert s.chat_history_turns == 8
    assert s.chat_session_message_cap == 30


def test_chat_model_env_override(monkeypatch):
    monkeypatch.setenv("ADMINDASH_CHAT_MODEL", "ollama:llama3.2")
    assert Settings().chat_model == "ollama:llama3.2"
