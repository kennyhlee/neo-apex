# ApexFlow Plan 1 — Interface Map

Authoritative binding map for the ApexFlow Plan 1 (headless workflow engine)
implementation. Every task in `2026-08-05-apexflow-plan1-foundations.md` cites
this file rather than writing signatures from memory. All signatures below
are copied **verbatim** from the source files named — file:line references
are current as of this map's creation on branch
`feat/apexflow-plan1-foundations`.

This map generalizes the registration engine's binding-map lesson (see
`2026-08-03-registration-plan5-followups.md`, "Plan defects found in Plan
5"): plan text that authors code snippets from memory drifts from the real
interfaces. Every one of the 18 defects Plan 5 found trace back to that.
This document is the countermeasure — cite it, don't paraphrase it.

---

## 1. enrollx DataCore client

Source: `enrollx/backend/app/registration/datacore.py`

```python
def dc_create(tenant_id: str, entity_type: str, base_data: dict, token: str | None = None) -> dict:
    # datacore.py:74
```
POSTs `{"base_data": base_data, "custom_fields": {}}` to
`/api/entities/{tenant_id}/{entity_type}`. Raises `HTTPException(resp.status_code, ...)`
on any non-`200`/`201` response. **`custom_fields` is always sent as `{}`** —
`dc_create` has no `custom_fields` parameter at all; a caller whose entity
needs custom fields on create must go straight to `dc.dc_update` afterward
(there is no create-with-custom-fields path).

```python
def dc_update(tenant_id: str, entity_type: str, entity_id: str, base_data: dict,
              token: str | None = None, custom_fields: dict | None = None) -> dict:
    # datacore.py:84-85
```
Full-replace PUT to `/api/entities/{tenant_id}/{entity_type}/{entity_id}`.
`custom_fields` defaults to `{}` — **and PUT replaces the stored
custom_fields wholesale**. Any caller round-tripping an entity that may
carry custom fields (e.g. the tenant entity, see `app/tenant_lookup.py`)
must fetch-and-pass them back explicitly or they are silently erased. See
`tenant_lookup.py:94` (`tenant_write_payload`) and `:129`
(`update_tenant_entity`) for the load-bearing example of this round-trip.

```python
def dc_query(tenant_id: str, sql: str, token: str | None = None, table: str = "entities") -> list[dict]:
    # datacore.py:104
```
Raw SQL passthrough to `POST /api/query`. **Not validated or escaped** —
callers must build `sql` from server-constructed predicates only and
`sql_literal()` (datacore.py:47) any caller-derived value themselves.
`FakeDataCore` in tests (see §5) makes calling this directly from engine
code an assertion failure — engine code must use `list_entities`/`get_entity`.

```python
def next_id(tenant_id: str, entity_type: str, token: str | None = None) -> str:
    # datacore.py:122
```
`GET /api/entities/{tenant_id}/{entity_type}/next-id`. Only works for
entity types registered in DataCore's `DEFAULT_ABBREVS` (see §6) — anything
else 400s.

```python
def list_entities(tenant_id: str, entity_type: str, where: str = "", token: str | None = None) -> list[dict]:
    # datacore.py:131
def get_entity(tenant_id: str, entity_type: str, entity_id: str, token: str | None = None) -> dict | None:
    # datacore.py:154
def get_model_definition(tenant_id: str, entity_type: str, token: str | None = None) -> dict | None:
    # datacore.py:171
```
`list_entities`/`get_entity` are the SANCTIONED entity-read path — the
module docstring (datacore.py:9) states engine code must reach these
through `list_entities`/`get_entity`, never raw `dc_query`. `where`, if
supplied, is a raw SQL fragment appended verbatim after `AND` and is **not**
validated by this module — build it only from server-constructed predicates,
escaping caller-derived values with `sql_literal`.
`get_model_definition` reads the `models` table (not `entities`) and
handles `model_definition` arriving as either a dict or a JSON string.
Returns `None` on no-model-for-type — callers must degrade to "no fields",
never fail the caller's operation over an absent model.

**Injection hygiene (datacore.py:13-21):** `tenant_id`, `entity_type`,
`entity_id` are always validated with the strict allow-list
`_ID_RE = re.compile(r"[A-Za-z0-9_-]+")` (datacore.py:33) via `_validate_id`
(datacore.py:36) before being placed in a URL path or SQL, raising
`HTTPException(400)` on rejection — never silently coerced.

**Error-relay convention:** every `dc_*` helper raises
`HTTPException(resp.status_code, f"DataCore {op} failed: {resp.text}")` on a
non-2xx — the upstream status code is passed through and the message is
prefixed, not masked. This is DIFFERENT from familyhub's `app/relay.py`
convention (§7), which masks upstream 5xx to a generic 502 for the
parent-facing channel. Do not conflate the two: `datacore.py`'s relay is
for staff/internal callers; `relay.py`'s is for the parent channel.

**Custom_fields handling, generally:** DataCore's PUT is a full replace of
both `base_data` and `custom_fields` (see §6, `store.put_entity`).
`custom_fields` and `base_data` may not share keys — DataCore's
`put_entity` raises `ValueError` → 400 on any overlap (store.py:325-330).

---

## 2. enrollx auth deps

Source: `enrollx/backend/app/auth.py` (authentication) +
`enrollx/backend/app/tenancy.py` (tenant/role enforcement) +
`enrollx/backend/app/api/internal.py` (internal-key dependency).

**The brief's presumed name `require_tenant_match` does NOT exist in
enrollx** — that name belongs to `admindash/backend/app/tenancy.py:291`.
enrollx's equivalent is `require_staff_tenant`. Note this explicitly so a
later task doesn't `from app.tenancy import require_tenant_match` and get
an `ImportError`.

```python
def require_authenticated_user(request: Request) -> dict:
    # auth.py:12
```
Validates the bearer token by calling `GET {settings.datacore_url}/auth/me`.
Returns the parsed user dict with `_token` set to the original
`Authorization` header value (so route handlers can forward it downstream).
401 on missing/malformed header or non-2xx from DataCore; 502 if DataCore
is unreachable.

```python
def require_role(*roles: str):
    # auth.py:59
```
Factory — returns a FastAPI dependency requiring `user["role"] in roles`
(403 otherwise). Mirrors launchpad's dependency of the same name.

```python
def require_staff_tenant(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    # tenancy.py:297
```
For routes with a `{tenant_id}` path param. Checks BOTH `user["role"] in
{"admin", "staff"}` (`STAFF_ROLES`, tenancy.py:30) AND
`user["tenant_id"] == tenant_id` (403 on either failure).

```python
def require_staff(user=Depends(require_authenticated_user)) -> dict:
    # tenancy.py:307
```
For routes with NO `{tenant_id}` path param (e.g. `/api/query`) — role check
only. The route itself must separately check tenant match against the
request body.

```python
def assert_query_tenant_match(request_tenant_id, user: dict) -> None:
    # tenancy.py:314
def assert_sql_is_safe_read(sql: str) -> None:
    # tenancy.py:326
```
`assert_query_tenant_match` is the REAL tenant check for `/api/query` — the
body's `tenant_id` must equal `user.get("tenant_id")`, 403 otherwise (and on
non-str/missing `tenant_id`). `assert_sql_is_safe_read` is defense-in-depth
on SQL *shape* only (single statement, starts SELECT/WITH, no
filesystem/network DuckDB function, no string literal in table-reference
position) — NOT the authoritative control; that's DataCore's
`external=True` (DuckDB `enable_external_access=false`). The SQL-shape guard
block (tenancy.py:32-294) is a byte-identical copy of
`datacore/src/datacore/api/readonly_query.py`'s guard and
`admindash/backend/app/tenancy.py`'s copy — keep all three in sync if it's
ported into apexflow-backend.

```python
def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    # api/internal.py:22
```
BINDING dependency name (Plan 5 tests reference it — will be true of
apexflow tests too). Constant-time compare
(`hmac.compare_digest`) of the `X-Internal-Key` header against
`settings.internal_key`. 401 on missing/mismatched key, no JWT involved —
this is the parent/internal channel's auth, entirely separate from
`require_authenticated_user`. `router = APIRouter(dependencies=[Depends(require_internal_key)])`
(api/internal.py:31) is the pattern for gating a whole router.

---

## 3. enrollx token module (magic links)

Source: `enrollx/backend/app/registration/tokens.py`

**Roadmap contract (tokens.py:1-18), exact:**
```
signature = HMAC-SHA256(ENROLLX_LINK_SECRET, "{tenant}.{app_entity_id}.{token_version}")
token     = urlsafe_b64("{tenant}.{app_entity_id}.{hex_signature}")  # padding stripped
```
No expiry field by design — revocation is bumping `token_version` on the
application entity.

```python
def make_link_token(tenant_id: str, application_id: str, token_version: int) -> str:
    # tokens.py:54
def parse_link_token(token: str) -> tuple[str, str, str]:
    # tokens.py:60  -> (tenant_id, application_id, hex_signature), UNAUTHENTICATED
def verify_link_token(token: str, token_version: int) -> tuple[str, str]:
    # tokens.py:89  -> (tenant_id, application_id), AUTHENTICATED
def magic_link_url(token: str) -> str:
    # tokens.py:97  -> f"{settings.familyhub_url}/application/{token}"
class TokenError(Exception):
    # tokens.py:27
```
`make_link_token` / `verify_link_token` are BINDING names. `parse_link_token`
does NOT check the signature — its return value must never be treated as
proof of scope; only `verify_link_token`'s result is authenticated.
`_sign` (tokens.py:31) uses `hmac.new(..., hashlib.sha256).hexdigest()`.
Signature comparison uses `hmac.compare_digest` (constant-time). Every
malformed-input path fails closed by raising `TokenError` — never an
unhandled exception. `tenant_id`/`application_id` must never contain `.` —
enforced at mint time by `_validate_scope` (tokens.py:40); `parse_link_token`
does an UNBOUNDED `split(".")` with exact-3 unpack, which is load-bearing
for scope isolation (comment at tokens.py:72-80 explains why — do not
"simplify" to a bounded split).

---

## 4. enrollx email module + Resend client surface

Source: `enrollx/backend/app/registration/emails.py`

```python
def send_email(to: str, subject: str, body_html: str) -> str:
    # emails.py:21  -> 'sent' | 'logged' | 'failed'
def send_application_email(tenant_id, application_entity_id, kind, to, subject,
                           body_html, token=None) -> str:
    # emails.py:45-46
```
`send_application_email` is a BINDING name (Plans 3/5). Note the param is
`body_html`, **not** `html`, because this module imports the stdlib `html`
module for escaping and a param named `html` would shadow it in-body.
`send_email` never raises — Resend failures degrade to `'failed'` and are
logged, since lifecycle actions must not break because email delivery is
down. When `settings.resend_api_key` is unset (dev/test), messages are
logged instead of sent (`'logged'`). `send_application_email` always
records the outcome as an `application_activity` of type `email_sent` via
`engine.log_activity(tenant_id, application_entity_id, "email_sent", "",
f"{kind}:{to}:{outcome}", "system", token)`.

`RESEND_URL = "https://api.resend.com/emails"` (emails.py:18). POST body:
`{"from": settings.email_from, "to": [to], "subject": subject, "html": body_html}`,
header `Authorization: Bearer {settings.resend_api_key}`, `timeout=15.0`.

v1 template functions, all `(*, ...) -> tuple[str, str]` returning
`(subject, body_html)`:
```python
def magic_link_email(school_label: str, link: str) -> tuple[str, str]:            # emails.py:65
def submission_receipt_email(school_label: str, application_display_id: str) -> tuple[str, str]:  # emails.py:82
def status_change_email(school_label: str, new_status: str) -> tuple[str, str]:   # emails.py:92
def action_needed_email(school_label: str, item_title: str, reason: str) -> tuple[str, str]:  # emails.py:103
```
`link` (a system-constructed URL) is used as-is in the `href` attribute —
NOT `html.escape()`-ed there (that would corrupt the URL, e.g. `&` →
`&amp;`), but IS escaped when rendered as the visible anchor text.
`school_label` is always the tenant's display name + school year (never a
program name — spec §5).

---

## 5. enrollx test fakes

Source: `enrollx/backend/tests/fakes.py`

```python
class FakeDataCore:
    def dc_create(self, tenant_id, entity_type, base_data, token=None):        # fakes.py:107
    def dc_update(self, tenant_id, entity_type, entity_id, base_data, token=None):  # fakes.py:117
    def next_id(self, tenant_id, entity_type, token=None):                     # fakes.py:127
    def list_entities(self, tenant_id, entity_type, where="", token=None):     # fakes.py:134
    def get_entity(self, tenant_id, entity_type, entity_id, token=None):       # fakes.py:154
    def set_model(self, tenant_id, entity_type, definition):                   # fakes.py:176
    def get_model_definition(self, tenant_id, entity_type, token=None):        # fakes.py:180
    def find(self, entity_type, **fields):                                    # fakes.py:184
def install_fake_datacore(monkeypatch, fdc: FakeDataCore):                     # fakes.py:189
```

**SIGNATURE DRIFT — fix while porting (Plan 3 follow-up #13,
`2026-08-03-registration-plan3-followups.md:99-101`):**
`FakeDataCore.dc_update` is `(self, tenant_id, entity_type, entity_id,
base_data, token=None)` — it has **no `custom_fields` parameter**, while
the real `app.registration.datacore.dc_update` (§1) is
`(tenant_id, entity_type, entity_id, base_data, token=None,
custom_fields=None)`. Any apexflow test that calls `dc_update(..., token=X,
custom_fields=Y)` against the fake gets a confusing `TypeError` (unexpected
keyword `custom_fields`), not a meaningful assertion failure. **When
porting `fakes.py` into apexflow-backend, add the `custom_fields=None`
parameter to `FakeDataCore.dc_update` and make `_store_row` merge it in**
so custom-fields round-trip tests (e.g. the tenant-entity pattern in §1) are
actually exercisable against the fake.

`install_fake_datacore` monkeypatches `dc_create`, `dc_update`, `next_id`,
`list_entities`, `get_entity`, `get_model_definition` onto
`app.registration.datacore`, and monkeypatches `dc_query` to
`fdc._no_raw_query` (fakes.py:158-161), which raises `AssertionError` if
called — enforcing the "engine code must not call `dc_query` directly"
rule from §1 at test time.

Other documented divergences from real DataCore (fakes.py:16-45), all
worth carrying into apexflow's port:
1. ID-prefix format: `TT-{XX}26####` (fake placeholder) vs real DataCore's
   tenant-derived abbreviation (see §6, `DEFAULT_ABBREVS` + `_abbrev`).
2. Internal `_tenant` column on `fdc.rows`, not present on real query rows.
3. Unrestricted auto-id assignment for ANY entity_type (real DataCore only
   auto-assigns for types in `DEFAULT_ABBREVS`, 400s otherwise).
4. No system columns (`_status`, `_version`, `_created_at`, …).
5. `dc_update` on an unknown `entity_id` raises `AssertionError` (fake) vs.
   real DataCore's PUT being an upsert with no existence check.

**Stringified reads (fakes.py:47-66, load-bearing, do not simplify away):**
see the "flattened-row vs envelope" gotcha below — `_scalar_to_str`
(fakes.py:74) is a verbatim mirror of
`datacore/src/datacore/query.py::_scalar_to_str`.

---

## 6. DataCore: entity routes, DEFAULT_ABBREVS, models read path, query guard

Source: `datacore/src/datacore/api/routes.py`,
`datacore/src/datacore/api/unified_routes.py`,
`datacore/src/datacore/store.py`, `datacore/src/datacore/query.py`.

```python
DEFAULT_ABBREVS = {
    "student": "ST", "program": "PR", "lead": "LD", "family": "FA",
    "registration_config": "RC", "registration_application": "RA",
    "application_item": "AI", "application_activity": "AA",
    "document": "DC", "payment": "PY", "enrollment": "EN",
}
# datacore/src/datacore/api/routes.py:20-32
```
**Any new apexflow entity type needing DataCore auto-ID (via `next_id` /
create-without-explicit-id) must be added here**, or `create_entity`
(routes.py:310) 400s with `"Auto-ID not supported for '{entity_type}'"`
(routes.py:96-97, checked again inline at routes.py:319 via
`needs_auto_id = entity_type in DEFAULT_ABBREVS and not base_data.get(id_field)`).

Entity routes (all under `@app.put`/`@app.post` inside
`register_routes(app, store)`, routes.py:67):
```python
@app.put("/api/entities/{tenant_id}/{entity_type}/{entity_id}")
def update_entity(tenant_id: str, entity_type: str, entity_id: str, body: CreateEntityRequest):
    # routes.py:294-295 -- calls store.put_entity(..., custom_fields=body.custom_fields)

@app.post("/api/entities/{tenant_id}/{entity_type}")
def create_entity(tenant_id: str, entity_type: str, body: CreateEntityRequest):
    # routes.py:310-311 -- auto-ID logic at 317-334, then store.put_entity(...)

@app.get("/api/entities/{tenant_id}/{entity_type}/next-id")
def next_entity_id(tenant_id: str, entity_type: str):
    # routes.py:93-94

@app.post("/api/entities/{tenant_id}/{entity_type}/archive")
def archive_entities(tenant_id: str, entity_type: str, body: ArchiveRequest):
    # routes.py:277-278

@app.post("/api/entities/{tenant_id}/{entity_type}/restore")
def restore_entities(tenant_id: str, entity_type: str, body: ArchiveRequest):
    # routes.py:285-286  -- inverse of archive
```
Auto-ID prefix construction (routes.py:322-334, matches `next_entity_id`'s
equivalent at 99-108): `abbrev` from the tenant's own
`base_data.get("_abbrev", tenant_id[:3].upper())`, `entity_abbrev` from
`DEFAULT_ABBREVS.get(entity_type, entity_type[:2])` (unless the tenant's
sequence record already pins one), `year`/`yy` from
`datetime.now(timezone.utc).year`. Prefix = `f"{abbrev}-{entity_abbrev}{yy}"`,
id = `f"{prefix}{seq:04d}"`.

Query passthrough (`app.registration.datacore.dc_query` in §1 hits this):
```python
# datacore/src/datacore/api/unified_routes.py:34-77
class QueryRequest(BaseModel):
    tenant_id: str
    table: TableName            # entities | models | tenants (Enum, unified_routes.py:16-19)
    sql: str

@router.post("/api/query")
def unified_query(req: QueryRequest):
```
Runs with `external=True` (DuckDB `enable_external_access=false`) — the
AUTHORITATIVE defense against filesystem/network SQL, covering every
caller regardless of proxy-layer guards (§2's `assert_sql_is_safe_read` is
secondary). `"tenants"` is a convenience alias — tenants are stored as
`entities`. Returns `{"data": result["rows"], "total": result["total"]}` —
note the key is normalized from `"rows"` to `"data"` here, which is what
`dc_query` (§1) reads via `resp.json().get("data", [])`.

There is a SEPARATE `/api/query/readonly` route
(`datacore/src/datacore/api/readonly_query.py:324-352`,
`register_readonly_query_routes`) with its own `ReadOnlyQueryRequest` and
`validate_readonly_sql` — used for LLM/semantic read paths, not the one
enrollx's `dc_query` hits. Do not confuse the two `/api/query*` routes.

**Store-level write (`datacore/src/datacore/store.py:307-386`,
`Store.put_entity`):**
```python
def put_entity(
    self, tenant_id: str, entity_type: str, entity_id: str,
    base_data: dict, custom_fields: dict | None = None, change_id: str | None = None,
) -> dict:
```
Archives the current active version, inserts a new one with incremented
`_version`. Raises `ValueError` if `base_data`/`custom_fields` keys
overlap (store.py:325-330) — surfaces as a `400` at the route layer
(routes.py:306-307, 344-345). **Encodes `base_data` and `custom_fields` as
TOON** on write (store.py:369-370: `toon.encode(base_data)`,
`toon.encode(custom_fields or {})`) — see the TOON gotcha below.

**Models read path** (`store.py`, referenced by `get_model_definition` in
§1 and launchpad/papermite in §8/§9): a separate `models` table, one row
per `entity_type`, `model_definition` column stored as a TOON/JSON string
depending on path — every reader (`enrollx/datacore.py:193-198`,
`launchpad/tenants.py:107-108`, `papermite/finalize.py:261-266`) has to
`json.loads()` it defensively because it "arrives as either a dict or a
JSON string depending on the storage path."

**Query passthrough guard helpers** (shared, byte-identical across three
copies — datacore's own `readonly_query.py`, admindash's `tenancy.py`,
enrollx's `tenancy.py`; see §2):
```python
def _strip_literals_and_comments(sql: str) -> str:   # blanks string literals/comments
def _sql_shape_error(sql: str) -> str | None:        # None == acceptable read query
def validate_readonly_sql(sql: str) -> str:          # readonly_query.py:307 -- raises ValueError
```

---

## 7. familyhub internal client

Source: `familyhub/backend/app/upstream.py`,
`familyhub/backend/app/config.py`, `familyhub/backend/app/relay.py`.

```python
def call_upstream(
    method: str, url: str, *, json_body: Optional[dict] = None,
    content: Optional[bytes] = None, headers: Optional[dict] = None,
) -> httpx.Response:
    # upstream.py:15-36
def internal_headers() -> dict:
    # upstream.py:39-40  -> {"X-Internal-Key": settings.enrollx_internal_key}
def enrollx(path: str) -> str:
    # upstream.py:43-44  -> f"{settings.enrollx_url}{path}"
def datacore(path: str) -> str:
    # upstream.py:47-48  -> f"{settings.datacore_url}{path}"
```
Every upstream call goes through `call_upstream` so tests can monkeypatch
ONE seam: `app.upstream.httpx.request`. Header name: **`X-Internal-Key`**
(matches enrollx's `require_internal_key` in §2). Base URLs from
`Settings` (config.py:13-14): `datacore_url: str = "http://localhost:5800"`,
`enrollx_url: str = "http://localhost:5910"`,
`enrollx_internal_key: str = "dev-internal-key-change-in-prod"` — must equal
enrollx's `ENROLLX_INTERNAL_KEY` (comment at config.py:15-16 flags this
must-match-across-services relationship explicitly).

Routes called today (`enrollx(...)` call sites, grep across
`familyhub/backend/app/api/*.py`):
- `registration.py:48` — `GET /internal/registration/{tenant_id}/config`
- `registration.py:103` — `POST /internal/registration/{tenant_id}/start`
- `application.py:32` — `GET /internal/application-by-token/{token}`
- `application.py:60` — `POST /internal/application-by-token/{token}/actions`
- `application.py:88` — `POST /internal/registration/{tenant_id}/request-link`
- `application.py:108` — `POST /internal/application-by-token/{token}/checkout`
- `documents.py:170` — `GET /internal/application-by-token/{token}` (token URL-quoted)
- `documents.py:408` — `GET /internal/application-by-token/{token}/documents`

**Error-relay convention** (`relay.py`, distinct from enrollx's — see §1):
```python
def relay(resp) -> Response:       # relay.py:30 -- 4xx passthrough verbatim, 5xx masked to 502
def upstream_unavailable() -> Response:  # relay.py:41 -- same masked 502, for non-HTTP failures
```
4xx from upstream is passed through verbatim (parent-safe: "registration
closed" is a real 404, not internal detail). Anything `>= 500` is NEVER
passed through — always masked to a fixed, non-diagnostic 502 — because an
application-level 5xx can carry a raw exception string or DataCore
internals in its body.

---

## 8. launchpad model seeding

Source: `launchpad/backend/app/api/tenants.py:171-229` +
`launchpad/backend/app/data/base_model.json`.

```python
@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin"))):
    # tenants.py:174-175

@router.post("/tenants/{tenant_id}/model/sync-defaults")
def sync_default_model(tenant_id: str, user=Depends(require_role("admin"))):
    # tenants.py:200-201
```
`BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"`
(tenants.py:171). Both routes 403 on `user["tenant_id"] != tenant_id`.
`use_default_model` PUTs the entire `base_model.json` to
`{datacore}/models/{tenant_id}` (full replace) then calls
`{datacore}/registry/onboarding/{tenant_id}/complete-step` with
`{"step_id": "model_setup"}`. `sync_default_model` is
NON-destructive: it queries the tenant's existing `models` table for
`entity_type`s already present, computes `missing = {et: def for et, def
in base_model.items() if et not in existing}`, and PUTs only `missing` —
existing entities and their customizations are untouched.

**`base_model.json` structural convention:**
```json
{
  "<entity_type>": {
    "base_fields": [
      {"name": "...", "type": "str|number|bool|date|selection|email|phone", "required": true|false, "options": [...] }
    ],
    "custom_fields": []
  }
}
```
Field dict keys observed: `name`, `type`, `required`, and optionally
`options` (for `selection`) — this is the same shape
`papermite/finalize.py`'s `_build_model_definition` / `_merge_model_definition`
produce and consume (§9), and the same shape
`launchpad/tenants.py:get_model_entities` (tenants.py:111-141) reads back
as `{entity_type: {base_fields, custom_fields}}`.

---

## 9. Papermite finalize path — model replacement

Source: `papermite/backend/app/api/finalize.py`.

```python
def _build_model_definition(entities: list[EntityResult]) -> dict:
    # finalize.py:180-228 -- extraction entities -> {entity_type: {base_fields, custom_fields}}

def _fetch_existing_model_definition(tenant_id: str) -> dict:
    # finalize.py:231-274 -- POST {datacore}/query, table="models", handles str-or-dict model_definition

def _merge_model_definition(existing: dict, incoming: dict) -> dict:
    # finalize.py:276-320 -- MERGE, pure function, no I/O, neither input mutated

@router.post("/tenants/{tenant_id}/finalize/commit")
async def finalize_commit(tenant_id: str, request: FinalizeRequest, user: UserRecord = Depends(require_admin)):
    # finalize.py:323-324
```
**Model replacement happens at finalize.py:340-360**: `finalize_commit`
computes `model_definition = _merge_model_definition(
_fetch_existing_model_definition(tenant_id), _build_model_definition(extraction.entities))`
then `httpx.put(f"{settings.datacore_api_url}/models/{tenant_id}", json={
"model_definition": model_definition, "source_filename": extraction.filename,
"created_by": user.name})`.

**MERGE, never replace** (spec §4 rule 1, finalize.py:279-320 docstring):
base fields are seeded by launchpad from `base_model.json` and are
load-bearing for running code (the registration engine writes `status`,
`config_version`, `token_version`, etc. onto every application). Per entity
type already present in `existing`: `base_fields` are preserved verbatim
(never removed/reordered/overwritten); any incoming field whose name
matches an existing base field is dropped (seeded declaration wins); every
remaining incoming field is appended to `custom_fields` unless already
present (first write wins — re-committing the same document is a no-op).
Entity types absent from `existing` are taken from `incoming` unchanged;
entity types absent from `incoming` are carried through untouched (a
single-entity extraction can never delete the rest of the tenant's model).
**Any apexflow entity-type/model work that touches papermite's finalize
path must preserve this merge invariant** — a naive replace would repeat
the exact regression this rule was written to prevent (dropping
`registration_application`'s engine-owned fields).

`finalize_commit` also 403s on `user.tenant_id != tenant_id` (finalize.py:330-331)
and 400s on `extraction.tenant_id != tenant_id` (finalize.py:334-335) before
touching the model at all.

---

## Gotchas

### A. entity_id vs. business-id identifier trap

DataCore's `entity_id` (an opaque, DataCore-assigned UUID-hex, e.g. from
`uuid.uuid4().hex[:12]` at `routes.py:314`) is a COMPLETELY DIFFERENT value
from the human-readable business id stored as a `base_data` field named
`"{entity_type}_id"` (e.g. `application_id` / `registration_application_id`,
format `RA-XX26####`). Confusing the two is the single most common source
of the "18 plan defects" class documented in
`2026-08-03-registration-plan5-followups.md`.

Concrete example — `enrollx/backend/app/registration/engine.py:326-362`
(`create_application`):
```python
app_id = dc.next_id(tenant_id, "registration_application", token)      # business id, e.g. "RA-RA260001"
base = {
    "application_id": app_id,
    "registration_application_id": app_id,   # DataCore's auto-ID field, pre-set to avoid a second mint
    ...
}
created = dc.dc_create(tenant_id, "registration_application", base, token)
app_entity_id = created["entity_id"]         # the OTHER id -- DataCore's opaque UUID-hex
items = [create_application_item(tenant_id, app_entity_id, fields, token) ...]   # entity_id used downstream
log_activity(tenant_id, app_entity_id, "status_change", "", "draft", actor, token)
```
Every downstream lookup (`get_application`, `dc_update`, `log_activity`,
`make_link_token`) uses `entity_id`, NOT the business id. The magic-link
token (§3) is explicitly minted from `app_entity_id`, never
`application_id` — Plan 5's follow-ups doc records that the plan's own
Global Constraints once stated the `uploaded_by` security rule with the
WRONG identifier (`parent:{application_id}` instead of the correct
`parent:{entity_id}`) in "the plan's most load-bearing paragraph"
(`2026-08-03-registration-plan5-followups.md:110-113`). Task 5 of the same
plan review found an item lookup that "keyed the business `item_id` where
hosts send `entity_id`" and would have 400'd every real upload while its
own test fixture stayed green (`...followups.md:120-121`).

**Rule for apexflow:** any function taking an "id" parameter must name it
`entity_id` or `{type}_id` explicitly in its signature — never a bare `id`
— and every call site must be checked against which one the callee
actually expects.

### B. TOON encoding of base_data

DataCore stores `base_data` and `custom_fields` as **TOON-encoded
documents**, not JSON, in the `entities` LanceDB table
(`store.py:58-59` schema comment: `# TOON-encoded document`). Write path:
`store.py:369-370`, `Store.put_entity`:
```python
"base_data": toon.encode(base_data),
"custom_fields": toon.encode(custom_fields or {}),
```
Read path (single-entity, `get_active_entity`, `store.py:411-412`):
```python
row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
```
This is the ENVELOPE shape — native Python types, `base_data` nested under
its own key. It's what `dc_create`/`dc_update`/`store.put_entity` return
directly.

The QUERY path (`datacore/src/datacore/query.py`) additionally FLATTENS
`base_data` (and `custom_fields`) into individual top-level string columns
(`_flatten_encoded_column`, query.py:199) via `_scalar_to_str`
(query.py:12-21) — see gotcha C below. Any code that builds or reads TOON
directly (rather than going through `dc_create`/`dc_update`/`list_entities`)
must import the real `toon` package (`import toon`, store.py:11,
query.py:7) — apexflow-backend either takes the same dependency or, more
likely, never touches TOON directly at all and only ever sees the decoded
envelope or the flattened query row.

### C. Flattened-row vs. envelope response shapes

Two DIFFERENT shapes are in play for the same logical entity, and mixing
them up silently produces wrong-typed or missing fields:

- **Envelope** (from `dc_create`/`dc_update`/`store.put_entity` directly):
  `{"entity_id": ..., "entity_type": ..., "base_data": {...natively typed...}}`.
  `entity_id` is a TOP-LEVEL key, not inside `base_data`.
- **Flattened** (from `dc_query`/`list_entities`/`get_entity`/`/api/query`):
  every `base_data`-derived value is merged onto the row as its OWN
  top-level column and STRINGIFIED via `_scalar_to_str`
  (`datacore/src/datacore/query.py:12-21`, mirrored verbatim in
  `enrollx/backend/tests/fakes.py:74-83`) — bools become the strings
  `"true"`/`"false"` (a `False` value reads back as the STRING `"false"`,
  which is TRUTHY in Python — `if row.get("blocking")` is a live bug
  pattern this exact fake was rewritten to catch, per `fakes.py:47-56`);
  dict/list become JSON strings; everything else goes through `str()`.
  `None` is preserved as `None`, not stringified (`fakes.py:100`,
  mirroring `query.py`'s `None if v is None else _scalar_to_str(v)`).

Plan 5 follow-up #10 (`2026-08-03-registration-plan5-followups.md:78-83`)
records a live instance of this trap: familyhub frontend's `entityData`
helper claims to "tolerate both shapes" for reading an id, but for the
envelope shape `entity_id` sits at the TOP level, not inside `base_data` —
so the helper actually returns `undefined` against a real envelope. The
BACKEND handles this correctly (`app_row.get("entity_id") or
app_raw.get("entity_id")`); the frontend, at the time of that finding, did
not. **Rule for apexflow:** never write an id-reader that assumes only one
of the two shapes; always check both, or better, keep the two shapes from
ever reaching the same code path (know which call produced the value you
have in hand).

### D. `FakeDataCore.dc_update` signature drift

Documented fully in §5. Restated here because it is the exact kind of
binding gap this map exists to close before it causes an opaque
`TypeError` mid-port: real `dc_update` (§1) accepts a `custom_fields`
keyword; `tests/fakes.py:117`'s `FakeDataCore.dc_update` does not. Fix
while porting `fakes.py` into apexflow-backend — do not port it unchanged
and rediscover this the way Plan 3 did.

### E. Error-relay conventions are NOT uniform

`enrollx/backend/app/registration/datacore.py` (§1) relays DataCore's own
status code with a prefixed message on every non-2xx. `familyhub`'s
`app/relay.py` (§7) does the opposite for the parent-facing channel: 4xx
passes through verbatim, but everything `>=500` is masked to a fixed 502
so upstream internals never reach a parent. When apexflow-backend grows
its own internal/facade split (mirroring familyhub's relationship to
enrollx), pick the convention deliberately per channel — staff-facing
internal errors can be more transparent than parent-facing ones.

### F. `require_tenant_match` does not exist in enrollx

See §2. The name exists only in `admindash/backend/app/tenancy.py:291`.
enrollx's tenant+role dependency for `{tenant_id}`-scoped routes is
`require_staff_tenant` (`enrollx/backend/app/tenancy.py:297`). Do not
import a name that isn't there.
