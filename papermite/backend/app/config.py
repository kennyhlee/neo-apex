import json
from pathlib import Path
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class TestUser(BaseModel):
    user_id: str
    name: str
    email: str
    password: str
    tenant_id: str
    tenant_name: str
    role: str


class Settings(BaseSettings):
    jwt_secret: str = "papermite-dev-secret-change-in-prod"
    jwt_expiry_hours: int = 24
    default_model: str = "anthropic:claude-haiku-4-5-20251001"
    available_models: list[str] = [
        "anthropic:claude-haiku-4-5-20251001",
        "anthropic:claude-sonnet-4-6",
        "openai:gpt-4.1",
        "openai:gpt-5",
        "ollama:llama3.2",
    ]
    upload_dir: Path = Path(__file__).parent.parent / "uploads"
    lancedb_dir: Path = Path(__file__).parent.parent / "data" / "lancedb"
    test_user_path: Path = Path(__file__).parent.parent.parent / "test_user.json"

    def load_test_user(self) -> TestUser:
        """Backward compat — returns the first user."""
        users = self.load_users()
        return users[0]

    def load_users(self) -> list[TestUser]:
        data = json.loads(self.test_user_path.read_text())
        if isinstance(data, dict) and "users" in data:
            return [TestUser(**u) for u in data["users"]]
        # Legacy single-user format
        return [TestUser(**data)]

    def find_user_by_email(self, email: str) -> TestUser | None:
        for user in self.load_users():
            if user.email.lower() == email.lower():
                return user
        return None

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
