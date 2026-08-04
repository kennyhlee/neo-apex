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


def test_send_application_email_logs_activity_sent(fake_dc, monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")

    class R:
        status_code = 200

    monkeypatch.setattr(httpx, "post", lambda *a, **k: R())
    outcome = emails.send_application_email("acme", "app-eid-2", "status_change",
                                            "p@x.com", "Subject", "<p>x</p>")
    assert outcome == "sent"
    acts = fake_dc.find("application_activity", application_id="app-eid-2")
    assert len(acts) == 1
    assert acts[0]["to_value"] == "status_change:p@x.com:sent"


def test_send_application_email_logs_activity_failed(fake_dc, monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", "re_key")

    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", boom)
    outcome = emails.send_application_email("acme", "app-eid-3", "action_needed",
                                            "p@x.com", "Subject", "<p>x</p>")
    assert outcome == "failed"
    acts = fake_dc.find("application_activity", application_id="app-eid-3")
    assert len(acts) == 1
    assert acts[0]["to_value"] == "action_needed:p@x.com:failed"


def test_templates_return_subject_and_html():
    for subject, html in (
        emails.magic_link_email("Acme Afterschool 2026-2027", "https://x/application/tok"),
        emails.submission_receipt_email("Acme Afterschool 2026-2027", "AC-RA260001"),
        emails.status_change_email("Acme Afterschool 2026-2027", "approved"),
        emails.action_needed_email("Acme Afterschool 2026-2027", "Immunization Record", "blurry scan"),
    ):
        assert isinstance(subject, str) and subject
        assert isinstance(html, str) and html.startswith("<")
    _, html = emails.magic_link_email("Acme Afterschool 2026-2027", "https://x/application/tok")
    assert "https://x/application/tok" in html
    _, html = emails.action_needed_email("Acme Afterschool 2026-2027", "Immunization Record", "blurry scan")
    assert "Immunization Record" in html and "blurry scan" in html


def test_action_needed_email_escapes_item_title_and_reason():
    _, html_body = emails.action_needed_email(
        "Acme Afterschool 2026-2027", "<script>alert(1)</script>", "R&D <bad>"
    )
    assert "<script>alert(1)</script>" not in html_body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_body
    assert "R&amp;D &lt;bad&gt;" in html_body


def test_magic_link_email_escapes_label_but_not_href():
    link = "https://x/application/tok?a=1&b=2"
    _, html_body = emails.magic_link_email("Fall <2026> & Co", link)
    # school_label is escaped as HTML content.
    assert "Fall &lt;2026&gt; &amp; Co" in html_body
    # The href attribute value is the raw, unescaped URL — escaping it would
    # corrupt the URL (e.g. turn `&` into `&amp;`).
    assert f'href="{link}"' in html_body
    # The same link rendered as visible anchor text IS escaped, since that
    # occurrence is HTML content rather than a URL.
    assert "https://x/application/tok?a=1&amp;b=2" in html_body


def test_submission_receipt_email_escapes_display_id():
    _, html_body = emails.submission_receipt_email("Acme Afterschool 2026-2027", "<b>AC-1</b>")
    assert "<b>AC-1</b>" not in html_body
    assert "&lt;b&gt;AC-1&lt;/b&gt;" in html_body


def test_status_change_email_escapes_new_status():
    _, html_body = emails.status_change_email("Acme Afterschool 2026-2027", "needs<review> & wait")
    assert "needs<review> & wait" not in html_body
    assert "needs&lt;review&gt; &amp; wait" in html_body
