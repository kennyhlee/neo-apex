"""Auth configuration — JWT secret, expiry, loaded from environment."""
import os


class AuthConfig:
    def __init__(
        self,
        jwt_secret: str | None = None,
        jwt_expiry_hours: int | None = None,
    ):
        self.jwt_secret = jwt_secret or os.environ.get(
            "DATACORE_JWT_SECRET", "neoapex-dev-secret-change-in-prod"
        )
        self.jwt_expiry_hours = jwt_expiry_hours or int(
            os.environ.get("DATACORE_JWT_EXPIRY_HOURS", "24")
        )
