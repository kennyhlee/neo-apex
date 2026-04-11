"""Tests for /api/extract/{tenant_id}/student multipart streaming proxy."""
import httpx
import respx


@respx.mock
def test_multipart_upload_is_proxied(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    route = respx.post(
        "http://localhost:5710/api/extract/t1/student"
    ).mock(
        return_value=httpx.Response(
            200, json={"first_name": "Ada", "last_name": "Lovelace"}
        )
    )

    file_bytes = b"%PDF-1.4 fake pdf content for test"
    resp = client.post(
        "/api/extract/t1/student",
        files={"file": ("test.pdf", file_bytes, "application/pdf")},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"first_name": "Ada", "last_name": "Lovelace"}
    assert route.called

    # Verify Papermite received a multipart body containing our file bytes
    forwarded = route.calls[0].request
    assert forwarded.headers["content-type"].startswith("multipart/form-data")
    assert file_bytes in forwarded.content


def test_unauthenticated_extract_returns_401(client):
    resp = client.post(
        "/api/extract/t1/student",
        files={"file": ("x.pdf", b"x", "application/pdf")},
    )
    assert resp.status_code == 401
