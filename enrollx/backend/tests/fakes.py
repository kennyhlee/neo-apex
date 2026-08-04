"""In-memory FakeDataCore — the ONE DataCore stub mechanism for this suite.

Usage in every test file that touches DataCore (repeat this fixture verbatim):

    from tests.fakes import FakeDataCore, install_fake_datacore

    @pytest.fixture
    def fake_dc(monkeypatch):
        fdc = FakeDataCore()
        install_fake_datacore(monkeypatch, fdc)
        return fdc

Rows are stored flattened (entity_id, entity_type + base_data fields), which
matches how DataCore's query endpoint returns entities.

Known divergences from the real DataCore service (harmless for this plan's
tests today, but worth knowing before relying on the fake for something new):

1. ID-prefix format. `dc_create`/`next_id` mint ids like `TT-{XX}26####`
   (`TT` = fake placeholder, `XX` = first two letters of entity_type,
   `26` = stand-in year, `####` = a monotonic sequence). The real DataCore
   `next-id` endpoint derives a tenant-specific abbreviation instead of the
   fixed `TT` prefix. A test asserting on a specific tenant-derived prefix
   (as opposed to just checking format/shape) would not port unmodified.
2. Internal `_tenant` column. Rows in `fdc.rows` carry a `_tenant` key used
   purely for in-memory tenant scoping. Real DataCore query rows do not
   have this column — tenant scope there comes from the request body, not
   a per-row field. Only visible if you read `fdc.rows` directly instead of
   going through `list_entities`/`get_entity`/`find`.
3. Unrestricted auto-id assignment. `dc_create`/`next_id` here auto-assign
   an id for ANY entity_type. The real DataCore only does this for types
   registered in its `DEFAULT_ABBREVS` table and returns 400 for anything
   else. The fake never rejects an unknown entity_type this way.
4. No system columns. The fake omits real DataCore system columns
   (`_status`, `_version`, `_created_at`, …) entirely — rows only have
   `entity_id`/`entity_type`/`_tenant` plus flattened base_data. This is
   harmless only because this plan never exercises archive/restore or
   version-history behavior against the fake.
5. Update-time existence check. `dc_update` here raises `AssertionError` on
   an unknown `entity_id`. The real DataCore PUT is an upsert with no
   existence check — it would create the row. This is the safe direction
   (the fake catches a bug — updating something that was never created —
   that the real service would silently paper over), so the behavior is
   kept as-is; it is documented here only so it isn't mistaken for
   real-service parity.
"""
import json
import re
import uuid


class FakeDataCore:
    def __init__(self):
        self.rows: list[dict] = []
        self.seq = 0

    # ── same signatures as app.registration.datacore ─────────────────────
    def dc_create(self, tenant_id, entity_type, base_data, token=None):
        base = dict(base_data)
        id_field = f"{entity_type}_id"
        if not base.get(id_field):
            self.seq += 1
            base[id_field] = f"TT-{entity_type[:2].upper()}26{self.seq:04d}"
        entity_id = uuid.uuid4().hex[:12]
        self.rows.append({"entity_id": entity_id, "entity_type": entity_type,
                          "_tenant": tenant_id, **base})
        return {"entity_id": entity_id, "entity_type": entity_type, "base_data": base}

    def dc_update(self, tenant_id, entity_type, entity_id, base_data, token=None):
        for i, r in enumerate(self.rows):
            if (r["entity_id"] == entity_id and r["entity_type"] == entity_type
                    and r["_tenant"] == tenant_id):
                self.rows[i] = {"entity_id": entity_id, "entity_type": entity_type,
                                "_tenant": tenant_id, **dict(base_data)}
                return {"entity_id": entity_id, "entity_type": entity_type,
                        "base_data": dict(base_data)}
        raise AssertionError(f"update of unknown entity {entity_type}/{entity_id}")

    def next_id(self, tenant_id, entity_type, token=None):
        self.seq += 1
        return f"TT-{entity_type[:2].upper()}26{self.seq:04d}"

    def list_entities(self, tenant_id, entity_type, where="", token=None):
        out = [dict(r) for r in self.rows
               if r["entity_type"] == entity_type and r["_tenant"] == tenant_id]
        for field, value in self._parse_where(where):
            out = [r for r in out if str(r.get(field, "")) == value]
        return out

    def get_entity(self, tenant_id, entity_type, entity_id, token=None):
        rows = self.list_entities(tenant_id, entity_type, f"entity_id = '{entity_id}'")
        return rows[0] if rows else None

    @staticmethod
    def _no_raw_query(*args, **kwargs):
        raise AssertionError(
            "engine code must not call dc_query directly — use list_entities/get_entity")

    @staticmethod
    def _parse_where(where):
        if not where:
            return []
        pairs = []
        for part in re.split(r"\s+AND\s+", where, flags=re.IGNORECASE):
            m = re.fullmatch(r"(\w+)\s*=\s*'([^']*)'", part.strip())
            if not m:
                raise AssertionError(f"FakeDataCore cannot parse where clause: {part!r}")
            pairs.append((m.group(1), m.group(2)))
        return pairs

    # ── test conveniences ─────────────────────────────────────────────────
    def find(self, entity_type, **fields):
        return [r for r in self.rows if r["entity_type"] == entity_type
                and all(str(r.get(k, "")) == str(v) for k, v in fields.items())]


def install_fake_datacore(monkeypatch, fdc: FakeDataCore):
    from app.registration import datacore as dc

    for name in ("dc_create", "dc_update", "next_id", "list_entities", "get_entity"):
        monkeypatch.setattr(dc, name, getattr(fdc, name))
    monkeypatch.setattr(dc, "dc_query", fdc._no_raw_query)


# ── Shared seed data for endpoint tests ───────────────────────────────────
BLOCKS = [
    {"block_id": "b1", "type": "form", "title": "Student Info", "required": True,
     "blocking": True, "config": {"entity_type": "student"}},
    {"block_id": "b2", "type": "documents", "title": "Documents", "required": True,
     "blocking": True, "config": {"docs": [
         {"name": "Immunization Record", "sensitive": True, "blocking": True},
         {"name": "Report Card", "blocking": False, "due_days_after_approval": 14},
     ]}},
    {"block_id": "b3", "type": "payment_plan", "title": "Choose a Plan", "required": True,
     "blocking": True, "config": {"currency": "usd", "amount_full": 50000, "plans": [
         {"type": "pay_in_full"},
         {"type": "deposit", "deposit_amount": 10000}]}},
    {"block_id": "b4", "type": "payment", "title": "Payment", "required": True,
     "blocking": True, "config": {"collects": "deposit"}},
    {"block_id": "b5", "type": "message", "title": "Welcome", "required": False,
     "blocking": False, "config": {"body": "Hi"}},
    {"block_id": "b6", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]
# Expected derived items from BLOCKS: 1 form + 2 documents + 1 payment = 4 items,
# of which 3 are blocking (Report Card is non-blocking, due 14 days post-approval).
# Note payment_plan amounts are INTEGER CENTS (binding contract with Plan 3).


def seed_program_and_config(fdc: FakeDataCore, tenant="acme", program_id="PR1", capacity=None):
    prog = {"program_id": program_id, "name": "Fall 2026 Afterschool"}
    if capacity is not None:
        prog["capacity"] = capacity
    fdc.dc_create(tenant, "program", prog)
    fdc.dc_create(tenant, "registration_config", {
        "config_id": "cfg1", "program_id": program_id, "version": 1,
        "status": "published", "blocks": json.dumps(BLOCKS)})
