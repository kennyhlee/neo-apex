import json as _j

import httpx
import pytest
import respx


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


def _stub_query(mock, *, lead_model=None, entity_rows=None):
    """Route /api/query by request body's `table`.

    lead_model: list[str] of stage options to expose as the lead model's
        `stage` selection field. None → models query returns empty (no model).
    entity_rows: list[dict] returned for entities-table queries.
    """
    def responder(request):
        body = _j.loads(request.content)
        if body.get("table") == "models":
            data = [{"model_definition": {"base_fields": [
                {"name": "stage", "type": "selection", "options": lead_model}]}}] if lead_model else []
            return httpx.Response(200, json={"data": data, "total": len(data)})
        rows = entity_rows or []
        return httpx.Response(200, json={"data": rows, "total": len(rows)})

    mock.post("http://localhost:5800/api/query").mock(side_effect=responder)


def test_stages_constant_is_ordered():
    from app.api.leads import DEFAULT_STAGES
    assert DEFAULT_STAGES == ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]


# ── create / list / get routes ────────────────────────────────────────────


@respx.mock
def test_create_lead_manual(client):
    _stub_auth(respx)
    _stub_query(respx)  # no lead model → DEFAULT_STAGES, first = "New"
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld1", "base_data": {
                "guardian_name": "Sam Rivera", "email": "sam@example.com",
                "source": "manual", "stage": "New"}})
    )
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "Sam Rivera", "email": "sam@example.com"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    sent = route.calls.last.request
    body = _j.loads(sent.content)
    assert body["base_data"]["source"] == "manual"
    assert body["base_data"]["stage"] == "New"


@respx.mock
def test_create_lead_permissive_forwards_extra_field(client):
    _stub_auth(respx)
    _stub_query(respx)  # no model → DEFAULT_STAGES
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={"entity_id": "ld1"}))
    # No email/phone (no longer required) + an extra custom field
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "No Contact", "referral_source": "Friend"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    body = _j.loads(route.calls.last.request.content)["base_data"]
    assert body["referral_source"] == "Friend"
    assert body["source"] == "manual"
    assert body["stage"] == "New"  # first DEFAULT_STAGE


@respx.mock
def test_create_lead_first_stage_from_model(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=["Inquiry", "Applied", "Enrolled"])
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={"entity_id": "ld1"}))
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "Sam", "email": "s@e.com"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    body = _j.loads(route.calls.last.request.content)["base_data"]
    assert body["stage"] == "Inquiry"  # first model stage option


@respx.mock
def test_list_leads_filters_by_stage(client):
    _stub_auth(respx)
    _stub_query(respx, entity_rows=[{"entity_id": "ld1", "stage": "Toured"}])
    resp = client.get("/api/leads/t1?stage=Toured", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    # Find the entities query (last call may be either; grab the entities one)
    entity_calls = [c for c in respx.calls
                    if c.request.url.path == "/api/query"
                    and _j.loads(c.request.content).get("table") != "models"]
    sql = _j.loads(entity_calls[-1].request.content)["sql"]
    assert "entity_type = 'lead'" in sql and "stage = 'Toured'" in sql


def test_list_leads_requires_auth(client):
    resp = client.get("/api/leads/t1")
    assert resp.status_code == 401


@respx.mock
def test_get_lead_returns_lead(client):
    _stub_auth(respx)
    _stub_query(respx, entity_rows=[{"entity_id": "ld1", "stage": "New"}])
    resp = client.get("/api/leads/t1/ld1", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json()["entity_id"] == "ld1"


@respx.mock
def test_get_lead_not_found(client):
    _stub_auth(respx)
    _stub_query(respx, entity_rows=[])
    resp = client.get("/api/leads/t1/missing", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 404


@respx.mock
def test_create_lead_honors_email_import_source(client):
    _stub_auth(respx)
    _stub_query(respx)
    # Case 1: email_import source is preserved
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld2", "base_data": {
                "guardian_name": "X", "email": "x@e.com",
                "source": "email_import", "stage": "New"}})
    )
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "X", "email": "x@e.com", "source": "email_import"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    body = _j.loads(route.calls.last.request.content)
    assert body["base_data"]["source"] == "email_import"

    # Case 2: unknown source falls back to manual
    route2 = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld3", "base_data": {
                "guardian_name": "X", "email": "x@e.com",
                "source": "manual", "stage": "New"}})
    )
    resp2 = client.post("/api/leads/t1",
        json={"guardian_name": "X", "email": "x@e.com", "source": "unknown_value"},
        headers={"Authorization": "Bearer good"})
    assert resp2.status_code == 201
    body2 = _j.loads(route2.calls.last.request.content)
    assert body2["base_data"]["source"] == "manual"


# ── stage transition routes ───────────────────────────────────────────────


@respx.mock
def test_stage_change_updates_and_logs(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"],
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
                              "stage": "New", "source": "manual"}])
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1", "base_data": {"stage": "Contacted"}}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert upd.called and act.called
    act_body = _j.loads(act.calls.last.request.content)["base_data"]
    assert act_body["type"] == "stage_change"
    assert act_body["stage_from"] == "New" and act_body["stage_to"] == "Contacted"
    assert act_body["created_by"] == "system"


@respx.mock
def test_stage_change_no_model_falls_back_to_default(client):
    """When the models query returns empty, DEFAULT_STAGES is used for validation."""
    _stub_auth(respx)
    _stub_query(respx, lead_model=None,  # no model
                entity_rows=[{"entity_id": "ld1", "stage": "New", "source": "manual"}])
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200  # "Contacted" is in DEFAULT_STAGES
    assert upd.called and act.called


@respx.mock
def test_stage_change_preserves_custom_field(client):
    """_lead_base_data must carry custom fields and drop system/metadata columns."""
    _stub_auth(respx)
    _stub_query(respx, lead_model=None,
                entity_rows=[{
                    "entity_id": "ld1", "entity_type": "lead",
                    "guardian_name": "Sam", "email": "s@e.com",
                    "stage": "New", "source": "manual",
                    "referral_source": "Friend",  # custom field
                    "base_data": {"guardian_name": "Sam"},  # system col → dropped
                    "custom_fields": {}, "vector": [0.1],
                    "_status": "active", "_version": 3, "_created_at": "x",
                    "_updated_at": "y", "_change_id": "c1"}])
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    put_body = _j.loads(upd.calls.last.request.content)["base_data"]
    assert put_body["referral_source"] == "Friend"  # custom field preserved
    assert put_body["stage"] == "Contacted"
    # system + metadata columns dropped
    for k in ("entity_id", "entity_type", "base_data", "custom_fields", "vector",
              "_status", "_version", "_created_at", "_updated_at", "_change_id"):
        assert k not in put_body


@respx.mock
def test_stage_change_same_stage_no_activity(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=None,
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam",
                              "stage": "Contacted", "source": "manual"}])
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Contacted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert not act.called


@respx.mock
def test_stage_change_rejects_unknown_stage(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=None)  # DEFAULT_STAGES, "Nope" not in it
    resp = client.patch("/api/leads/t1/ld1/stage", json={"stage": "Nope"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 400


# ── activity create + timeline routes ────────────────────────────────────────


@respx.mock
def test_add_activity(client):
    _stub_auth(respx)
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={"entity_id": "la1"}))
    resp = client.post("/api/leads/t1/ld1/activities",
        json={"type": "call", "body": "Left voicemail"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    b = _j.loads(act.calls.last.request.content)["base_data"]
    assert b["type"] == "call" and b["lead_id"] == "ld1" and b["created_by"] == "u1"


@respx.mock
def test_add_activity_rejects_bad_type(client):
    _stub_auth(respx)
    resp = client.post("/api/leads/t1/ld1/activities",
        json={"type": "carrier_pigeon", "body": "x"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 400


@respx.mock
def test_list_activities_desc(client):
    _stub_auth(respx)
    _stub_query(respx, entity_rows=[{"entity_id": "la2"}, {"entity_id": "la1"}])
    resp = client.get("/api/leads/t1/ld1/activities", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    sql = _j.loads(respx.calls.last.request.content)["sql"]
    assert "lead_activity" in sql and "lead_id = 'ld1'" in sql and "ORDER BY _created_at DESC" in sql


# ── convert lead routes ───────────────────────────────────────────────────


@respx.mock
def test_convert_creates_family_student_and_links(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=["Inquiry", "Applied", "Enrolled"],
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
                              "stage": "Applied", "source": "manual"}])
    fam = respx.post("http://localhost:5800/api/entities/t1/family").mock(
        return_value=httpx.Response(201, json={"entity_id": "fam1", "base_data": {"family_id": "F-1"}}))
    stu = respx.post("http://localhost:5800/api/entities/t1/student").mock(
        return_value=httpx.Response(201, json={"entity_id": "stu1"}))
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    act = respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "Rivera Family", "primary_address": "1 Main St",
              "student_first_name": "Ada", "student_last_name": "Rivera"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    assert fam.called and stu.called and upd.called and act.called
    stu_body = _j.loads(stu.calls.last.request.content)["base_data"]
    assert stu_body["family_id"] == "fam1" and stu_body["status"] == "Enrolled"
    lead_body = _j.loads(upd.calls.last.request.content)["base_data"]
    # default target = LAST model stage option
    assert lead_body["converted_family_id"] == "fam1" and lead_body["stage"] == "Enrolled"


@respx.mock
def test_convert_honors_explicit_target_stage(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=["Inquiry", "Applied", "Accepted", "Enrolled"],
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam",
                              "stage": "Applied", "source": "manual"}])
    respx.post("http://localhost:5800/api/entities/t1/family").mock(
        return_value=httpx.Response(201, json={"entity_id": "fam1"}))
    respx.post("http://localhost:5800/api/entities/t1/student").mock(
        return_value=httpx.Response(201, json={"entity_id": "stu1"}))
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "X", "primary_address": "Y",
              "student_first_name": "A", "student_last_name": "B",
              "target_stage": "Accepted"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    lead_body = _j.loads(upd.calls.last.request.content)["base_data"]
    assert lead_body["stage"] == "Accepted"


@respx.mock
def test_convert_rejects_target_stage_not_in_options(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=["Inquiry", "Applied", "Enrolled"],
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam",
                              "stage": "Applied", "source": "manual"}])
    respx.post("http://localhost:5800/api/entities/t1/family").mock(
        return_value=httpx.Response(201, json={"entity_id": "fam1"}))
    respx.post("http://localhost:5800/api/entities/t1/student").mock(
        return_value=httpx.Response(201, json={"entity_id": "stu1"}))
    respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "X", "primary_address": "Y",
              "student_first_name": "A", "student_last_name": "B",
              "target_stage": "Bogus"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 400


@respx.mock
def test_convert_preserves_custom_field(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=None,
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
                              "stage": "Toured", "source": "manual",
                              "referral_source": "Friend",
                              "base_data": {}, "custom_fields": {}, "vector": [0.1],
                              "_status": "active", "_version": 1}])
    respx.post("http://localhost:5800/api/entities/t1/family").mock(
        return_value=httpx.Response(201, json={"entity_id": "fam1"}))
    respx.post("http://localhost:5800/api/entities/t1/student").mock(
        return_value=httpx.Response(201, json={"entity_id": "stu1"}))
    upd = respx.put("http://localhost:5800/api/entities/t1/lead/ld1").mock(
        return_value=httpx.Response(200, json={"entity_id": "ld1"}))
    respx.post("http://localhost:5800/api/entities/t1/lead_activity").mock(
        return_value=httpx.Response(201, json={}))
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "X", "primary_address": "Y",
              "student_first_name": "A", "student_last_name": "B"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    lead_body = _j.loads(upd.calls.last.request.content)["base_data"]
    assert lead_body["referral_source"] == "Friend"
    assert lead_body["converted_family_id"] == "fam1"
    assert lead_body["stage"] == "Lost"  # last DEFAULT_STAGE
    assert "vector" not in lead_body and "_status" not in lead_body


@respx.mock
def test_convert_guards_double_conversion(client):
    _stub_auth(respx)
    _stub_query(respx, lead_model=None,
                entity_rows=[{"entity_id": "ld1", "guardian_name": "Sam", "email": "s@e.com",
                              "stage": "Enrolled", "converted_family_id": "famX"}])
    resp = client.post("/api/leads/t1/ld1/convert",
        json={"family_name": "X", "primary_address": "Y",
              "student_first_name": "A", "student_last_name": "B"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 409
    assert "famX" in resp.json()["detail"]


# ── public intake route ───────────────────────────────────────────────────────


@respx.mock
def test_public_intake_creates_web_form_lead(client):
    # tenant existence check (entities) + model query both route through _stub_query
    _stub_query(respx, lead_model=None, entity_rows=[{"entity_id": "t1"}])
    create = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={"entity_id": "ld1"}))
    resp = client.post("/api/public/leads/t1",
        json={"guardian_name": "Prospect", "email": "p@e.com", "stage": "Enrolled",
              "converted_family_id": "hack"})  # internal fields must be ignored
    assert resp.status_code == 201
    b = _j.loads(create.calls.last.request.content)["base_data"]
    assert b["source"] == "web_form" and b["stage"] == "New"
    assert "converted_family_id" not in b


@respx.mock
def test_public_intake_unknown_tenant_404(client):
    _stub_query(respx, lead_model=None, entity_rows=[])  # tenant not found
    resp = client.post("/api/public/leads/ghost",
        json={"guardian_name": "P", "email": "p@e.com"})
    assert resp.status_code == 404


@respx.mock
def test_public_intake_rejects_malformed_tenant_id(client):
    """tenant_id with characters outside [A-Za-z0-9_-] must be rejected before DataCore is called."""
    # No DataCore routes registered — if the code reaches _tenant_exists/_dc_query it will error
    resp = client.post(
        "/api/public/leads/t1'%20OR%201=1",
        json={"guardian_name": "Probe", "email": "p@e.com"},
    )
    assert resp.status_code in (400, 404)


def test_public_intake_needs_no_jwt(client):
    # No Authorization header at all — must not 401 on auth (tenant check will run)
    import respx as _r
    with _r.mock:
        _stub_query(_r, lead_model=None, entity_rows=[])  # tenant not found → 404, not 401
        resp = client.post("/api/public/leads/t1", json={"guardian_name": "P", "phone": "555"})
    assert resp.status_code != 401


@respx.mock
def test_public_intake_source_field_overridden(client):
    """Prospect-supplied source/stage/converted_family_id must never reach DataCore."""
    _stub_query(respx, lead_model=None, entity_rows=[{"entity_id": "t1"}])
    create = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={"entity_id": "ld1"}))
    resp = client.post("/api/public/leads/t1",
        json={"guardian_name": "Prospect", "email": "p@e.com",
              "source": "email_import", "stage": "Enrolled",
              "converted_family_id": "fam-hack"})
    assert resp.status_code == 201
    b = _j.loads(create.calls.last.request.content)["base_data"]
    assert b["source"] == "web_form"
    assert b["stage"] == "New"
    assert "converted_family_id" not in b
