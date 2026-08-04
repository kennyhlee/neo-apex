"""Resend email: key-unset logging mode, real POST shape, activity logging."""
import httpx
import pytest

from app.config import settings
from app.registration import emails
from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_send_email_logs_when_key_unset(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "")
    hit = {}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: hit.setdefault("called", True))
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "logged"
    assert "called" not in hit


def test_send_email_posts_to_resend(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")
    captured = {}

    class R:
        status_code = 200

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(url=url, headers=headers, json=json)
        return R()

    monkeypatch.setattr(httpx, "post", fake_post)
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "sent"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_key"
    assert captured["json"]["from"] == settings.email_from
    assert captured["json"]["to"] == ["p@x.com"]
    assert captured["json"]["subject"] == "Hi"
    assert captured["json"]["html"] == "<p>hi</p>"


def test_send_email_failure_is_swallowed(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")

    class R:
        status_code = 422
        text = "bad"

    monkeypatch.setattr(httpx, "post", lambda *a, **k: R())
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "failed"

    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", boom)
    assert emails.send_email("p@x.com", "Hi", "<p>hi</p>") == "failed"


def test_send_application_email_logs_activity(fake_dc, monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "")
    outcome = emails.send_application_email("acme", "app-eid-1", "magic_link",
                                            "p@x.com", "Subject", "<p>x</p>")
    assert outcome == "logged"
    acts = fake_dc.find("application_activity", application_id="app-eid-1")
    assert len(acts) == 1
    assert acts[0]["type"] == "email_sent"
    assert acts[0]["to_value"] == "magic_link:p@x.com:logged"


def test_templates_return_subject_and_html():
    for subject, html in (
        emails.magic_link_email("Fall 2026", "https://x/application/tok"),
        emails.submission_receipt_email("Fall 2026", "AC-RA260001"),
        emails.status_change_email("Fall 2026", "approved"),
        emails.action_needed_email("Fall 2026", "Immunization Record", "blurry scan"),
    ):
        assert isinstance(subject, str) and subject
        assert isinstance(html, str) and html.startswith("<")
    _, html = emails.magic_link_email("Fall 2026", "https://x/application/tok")
    assert "https://x/application/tok" in html
    _, html = emails.action_needed_email("Fall 2026", "Immunization Record", "blurry scan")
    assert "Immunization Record" in html and "blurry scan" in html
