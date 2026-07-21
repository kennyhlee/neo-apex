import httpx
import respx


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


def test_stages_constant_is_ordered():
    from app.api.leads import STAGES
    assert STAGES == ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]
