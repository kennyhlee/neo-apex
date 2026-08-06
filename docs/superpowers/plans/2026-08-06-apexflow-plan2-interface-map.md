# ApexFlow Plan 2 — Interface Map (Designer)

Authoritative binding map for ApexFlow Plan 2 (workflow-designer frontend +
its backend read surface). Every task in
`2026-08-06-apexflow-plan2-designer.md` cites this file rather than writing
signatures from memory. All signatures below are copied **verbatim** from
the source files named — file:line references are current as of this map's
creation on branch `feat/apexflow-plan2-designer`.

Plan 1's lesson (`2026-08-05-apexflow-plan1-interface-map.md`'s own
opening): plan text that authors code snippets from memory drifts from the
real interfaces. Plan 1's only live bug was a stale port constant. §7 below
is this map's direct countermeasure — a table of every port/URL/env-var/
localStorage-key/services.json entry the designer touches, each with its
source file:line, cross-checked against the files on disk (not against any
cached description of them).

---

## 1. admindash-frontend reusable patterns

All paths relative to `admindash/frontend/src/` unless stated otherwise.

### 1a. AuthContext

Source: `admindash/frontend/src/contexts/AuthContext.tsx:1-75` (full file).

```ts
const TOKEN_KEY = 'neoapex_token';                                    // :4

interface AuthState {
  user: TestUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  ready: boolean;
}                                                                       // :6-11

export function AuthProvider({ children }: { children: ReactNode }) {  // :20
  // useEffect on mount (:24-40): reads TOKEN_KEY from localStorage; if
  // present, GET `${ADMINDASH_API_URL}/auth/me` with `Authorization: Bearer
  // ${token}`; on non-ok throws, caught and clears the token; sets `ready`
  // in a `.finally()` either way.

  const login = useCallback(async (email: string, password: string) => {  // :42
    // POST `${ADMINDASH_API_URL}/auth/login` {email, password};
    // on !resp.ok returns false; else localStorage.setItem(TOKEN_KEY,
    // data.token), setUser(data.user), returns true. try/catch -> false.
  }, []);

  const logout = useCallback(() => {                                  // :59
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('admindash_chat_history');               // :63
  }, []);
  // ...
}

export function useAuth() {                                            // :73
  return useContext(AuthContext);
}
```

**No exchange-code flow exists anywhere in admindash-frontend or
admindash-backend.** `AuthContext.tsx` only does username/password login
against its own backend's `/auth/login`, and `LoginPage.tsx` (below) has no
`code=` query-param handling. `grep -rln "exchange"` across
`admindash/frontend/src` and `admindash/backend` returns zero matches (auth
routes: `admindash/backend/app/api/auth.py` has only `POST /login` at
`:10` and `GET /me` at `:37`, each proxying to DataCore's `/auth/login`
(`:21`) / `/auth/me` (`:49`) unchanged). The real exchange-code implementation lives
in `datacore/src/datacore/api/auth_routes.py:78` (`POST /exchange-code`,
issuer) and is *consumed* by `launchpad/frontend/src/api/client.ts:19`
(`getExchangeCode`) and `papermite/frontend/src/api/client.ts`. If the
designer needs cross-service navigation via exchange codes, port from
launchpad's `client.ts`, not from admindash — admindash has nothing to copy
here.

### 1b. Login page

Source: `admindash/frontend/src/pages/LoginPage.tsx:1-114` (full file, no
truncation). Plain email/password form; on submit calls `useAuth().login`,
navigates to `/home` on success, else shows
`t('login.invalidCredentials')`. Includes a locale `<select>` wired to
`useTranslation()`'s `setLocale`. No exchange-code / redirect-from-another-
service handling (see 1a).

### 1c. config.ts

Source: `admindash/frontend/src/config.ts:1-26` (full file).

```ts
import services from '../../../services.json';                        // :1

function svcUrl(key: string): string {                                 // :3
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const ADMINDASH_API_URL =                                       // :8-9
  import.meta.env.VITE_ADMINDASH_API_URL || svcUrl("admindash-backend");

function envInt(name: string, fallback: number): number { ... }        // :11-16

export const BULK_ADD_DOCUMENT_CAP = envInt('VITE_BULK_ADD_DOCUMENT_CAP', 50);      // :19
export const BULK_ADD_CSV_ROW_CAP = envInt('VITE_BULK_ADD_CSV_ROW_CAP', 500);       // :22
export const BULK_ADD_CONCURRENCY = envInt('VITE_BULK_ADD_CONCURRENCY', 5);         // :25
```

Pattern to copy verbatim for apexflow-frontend's own `config.ts`: import
`services.json` from the repo root (three `../` up from
`{service}/frontend/src/`), resolve the backend URL via `svcUrl(key)`, allow
a `VITE_*` override. apexflow's key in `services.json` is
`"apexflow-backend"` (see §7).

### 1d. API client / fetch wrapper

Source: `admindash/frontend/src/api/client.ts:1-310` (full file read).

```ts
const API_BASE = ADMINDASH_API_URL;                                    // :16
const TOKEN_KEY = 'neoapex_token';                                     // :17

function authHeaders(): Record<string, string> {                       // :19
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

**There is no shared generic `request()`/`fetchJson()` wrapper and no
structured error shape.** Every exported function (`postQuery`,
`archiveEntities`, `updateEntity`, `createEntity`, `extractStudentFromDocument`,
`fetchAvailableModels`, `fetchNextEntityId`, `checkDuplicateStudents`,
`listLeads`, `getLead`, `createLead`, `updateLeadStage`, `listActivities`,
`addActivity`, `convertLead`, `fetchPublicLeadModel`, `submitPublicLead`,
`searchFamilies`, `getFamilyById`, `getStudentsByFamily`, `createFamily`,
`searchStudents`) independently does:
```ts
const resp = await fetch(url, { headers: { 'Content-Type': 'application/json', ...authHeaders() }, ... });
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
return resp.json();
```
(`convertLead` at `:227-235` is the one exception — it special-cases `409`
to throw `await resp.text()` instead of the generic message.) There is no
parsed error body, no error code/detail extraction anywhere in this file.
If the designer's api client wants a richer error shape, it must build one;
there is nothing to port here beyond the bare pattern above.

`escapeSql` (`:255-257`) — `value.replace(/'/g, "''")` — is the only
injection-safety helper in this file; several read functions build raw SQL
strings client-side (`searchFamilies`, `getFamilyById`,
`getStudentsByFamily`, `searchStudents`) and POST them to
`${API_BASE}/api/query` via `postQuery` (`:24-36`, `{tenant_id, table, sql}`
body). `postQuery`'s `table` param type is `'entities' | 'models' | 'tenants'`
— matches DataCore's `TableName` enum (§5).

### 1e. i18n

Source: `admindash/frontend/src/hooks/useTranslation.ts:1-37` (full file).

```ts
const STORAGE_KEY = 'preferredLanguage';                               // :4

function getInitialLocale(): Locale { ... }                            // :6-10
let globalLocale: Locale = getInitialLocale();                         // :12
const listeners = new Set<() => void>();                               // :13

export function useTranslation() {                                     // :15
  const [locale, setLocaleState] = useState<Locale>(globalLocale);
  // subscribes to `listeners` so every mounted hook re-renders on locale change
  const t = useCallback((key: string): string => translations[locale]?.[key] ?? key, [locale]);
  const setLocale = useCallback((lang: Locale) => {
    globalLocale = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    listeners.forEach((fn) => fn());
  }, []);
  return { t, locale, setLocale };
}
```

**File layout note — this deviates from CLAUDE.md's description.**
`admindash/CLAUDE.md` describes `i18n/` as "Translation JSON files keyed by
locale," but the actual layout is a single TypeScript file:
`admindash/frontend/src/i18n/translations.ts` (plus
`i18n/__tests__/translations.test.ts`) — not JSON, not one file per locale.
Its shape (`translations.ts:1-3`):
```ts
export type Locale = 'en-US' | 'zh-CN';
export const translations: Record<Locale, Record<string, string>> = {
  'en-US': { 'nav.home': 'Home', ... },
  ...
};
```
Global module-level `globalLocale` + listener-set pattern (not React
context) is the "global listener pattern" CLAUDE.md's own Architecture
section names. `familyhub/frontend/src/hooks/useTranslation.ts` uses the
identical `STORAGE_KEY = 'preferredLanguage'` (`:4`) — same key, same
pattern, a second independent copy (not shared code) — familyhub's own
`flow-runtime/src/i18n.ts:87` also reads `localStorage.getItem('preferredLanguage')`
directly. Any new frontend sharing this convention should read/write the
same `'preferredLanguage'` key so locale choice is consistent if a user
crosses services in one browser (it is NOT currently synced across
services — each app owns its own read).

### 1f. Shared UI components

**DataTable** — `admindash/frontend/src/components/DataTable.tsx:5-104`
(props interfaces + signature, full):
```ts
export interface Column<T> {                                           // :5
  key: string; label: string; i18nKey?: string;
  render?: (row: T) => ReactNode;
  numeric?: boolean;    // right-align, tabular figures
  primary?: boolean;    // stays visible as the card title below 768px
}
export interface EmptyState { title: string; description?: string; action?: ReactNode; }  // :16
interface DataTableProps<T> {                                          // :22
  columns: Column<T>[]; data: T[]; total: number; page: number; pageSize: number;
  loading?: boolean; onPageChange: (page: number) => void; rowKey: (row: T) => string;
  rowLabel?: (row: T) => string;
  sortBy?: string; sortDir?: 'asc' | 'desc'; onSortChange?: (column: string) => void;
  pageSizeOptions?: number[]; onPageSizeChange?: (size: number) => void;
  hiddenColumns?: string[]; rowClassName?: (row: T) => string;
  selectedIds?: Set<string>; onSelectionChange?: (ids: Set<string>) => void; selectable?: boolean;
  renderExpanded?: (row: T) => ReactNode; expandedIds?: Set<string>; onToggleExpand?: (id: string) => void;
  rowActions?: (row: T) => ReactNode; onRowClick?: (row: T) => void;
  emptyState?: EmptyState; caption?: string;
}
export default function DataTable<T extends Record<string, any>>({ ... }: DataTableProps<T>) { ... }  // :76-103
```

**Toast / useToast** — provider at
`admindash/frontend/src/components/ui/Toast.tsx:1-123` (full file),
context/hook at `admindash/frontend/src/hooks/useToast.ts:1-17` (full
file):
```ts
export function ToastProvider({ children }: { children: ReactNode }) { ... }  // Toast.tsx:16
// toast(options: ToastOptions) -> number id; default duration 5000ms
// (DEFAULT_MS, Toast.tsx:5), 10000ms when `onUndo` is supplied (UNDO_MS,
// Toast.tsx:6). Undo failure re-tones the toast to 'danger' in place
// (Toast.tsx:60-77) rather than dismissing it.

export function useToast(): ToastApi {                                 // useToast.ts:10
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
```

**Modal** — `admindash/frontend/src/components/ui/Modal.tsx:1-61+` (props
interface + signature, full):
```ts
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';                     // :15
interface ModalProps {                                                  // :17
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode; size?: ModalSize;
  variant?: 'modal' | 'drawer'; dismissOnBackdrop?: boolean; dismissOnEscape?: boolean;
  hideClose?: boolean; className?: string; footerClassName?: string;
}
export function Modal({ open, onClose, title, subtitle, children, footer,
  size = 'md', variant = 'modal', dismissOnBackdrop = true,
  dismissOnEscape = true, hideClose = false, className = '',
  footerClassName = '' }: ModalProps) { ... }                          // :47-61
```
Module-level `openStack: string[]` (`:13`) scopes Escape to the topmost
overlay across nested modals — a single shared stack, not per-instance
state.

**Button** — `admindash/frontend/src/components/ui/Button.tsx:1-54` (full
file):
```ts
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';  // :3
export type ButtonSize = 'sm' | 'md' | 'lg';                            // :4
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {  // :6
  variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; block?: boolean;
  loading?: boolean; loadingText?: string; children?: ReactNode;
}
export function Button({ variant = 'secondary', size = 'md', icon = false,
  block = false, loading = false, loadingText, disabled, className = '',
  children, type = 'button', ...rest }: ButtonProps) { ... }           // :22-51
```

**StatusBadge** — `admindash/frontend/src/components/StatusBadge.tsx:1-15`
(full file):
```ts
export default function StatusBadge({ status }: { status?: unknown }) {  // :9
  const label = toLabel(status, '');
  if (!label || label === '-') return <span>—</span>;
  return <span className={`status-badge status-badge--${toneFor(status)}`}>{label}</span>;
}
```
Tone resolution is delegated to `utils/tone.ts`'s `toneFor` — kept out of
this component deliberately so the badge and any other tone-consuming UI
(e.g. saved-view chips) can't drift apart (component's own comment,
`StatusBadge.tsx:5-7`).

### 1g. theme.css structure

Source: `admindash/frontend/src/styles/theme.css` — header comment at
`:1-21` states the layer order (1. `@neoapex/ui-tokens` shared suite
tokens, 2. this file overriding locally) and the file's own internal
structure:
```
A. Primitives      — palette, type scale, spacing scale, radii, shadows   (:23+)
B. Density         — tokens that differ between comfortable / compact
C. Compatibility   — every legacy token name re-pointed at a primitive
```
`:26-59` (Primitives, Neutrals/Accent groups) — every color is a CSS
custom property under `:root`, e.g. `--ground: #F8FAFC;` (`:36`),
`--accent: #378ADD;` (`:51`), `--accent-hover: #2B6FB5;` (`:52`) — the
`admindash/CLAUDE.md` accent/accent-ink accessibility rule (border/focus/
`accent-color` take `--accent`; text/background take `--accent-ink`)
governs any component the designer ports that touches color. Semantic
tones (`--success`, `--attn`, `--danger`, `--info`, `--away`, `--neutral`,
each with a paired `-tint`) are declared at `:57-63`, explicitly "outside
the accent hue" per the file's own comment (`:53-56`) — a status must never
read as a clickable action.

### 1h. eslint config

Source: `admindash/frontend/eslint.config.js:1-23` (full file, verbatim):
```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
```

---

## 2. apexflow-backend current surface

All paths relative to `apexflow/backend/app/` unless stated otherwise.
Files as of this map's creation: `api/{definitions,documents,instances,internal}.py`,
`auth.py`, `config.py`, `main.py`,
`workflows/{conditions,datacore,definitions,emails,engine,machine,primitives,schema,shared,tokens,validate}.py`.
**There is no `api/actions.py` or `api/model-impact.py`** — the "actions"
and "model-impact" endpoints the brief names live inside
`api/definitions.py` (`model-impact`) and both `api/definitions.py` +
`api/instances.py` (two separate `actions` endpoints — definition
lifecycle actions vs. instance actions, different resources, same verb).

### 2a. Routes — `api/definitions.py` (full file, `api/definitions.py:1-64`)

```python
router = APIRouter(prefix="/api/workflows")                            # :20

class ActionRequest(BaseModel):                                        # :23
    model_config = ConfigDict(extra="allow")
    action: str

@router.post("/{tenant_id}/definitions/{entity_id}/actions")           # :38
def definition_action(tenant_id: str, entity_id: str, body: ActionRequest,
                      user: dict = Depends(require_staff_tenant)):     # :39-40
    # body.action in {"publish","deprecate","reactivate","retire"} dispatches to
    # app.workflows.definitions.{publish_definition,deprecate_definition,
    # reactivate_definition,retire_definition}; "retire" also takes
    # force_cancel: bool from extra params. Unknown action -> 400.

@router.get("/{tenant_id}/model-impact")                               # :59
def model_impact(tenant_id: str, entity_type: str, field: str | None = None,
                 user: dict = Depends(require_staff_tenant)):          # :60-61
    # -> {"references": [...]}  (defs.model_impact(tenant_id, entity_type, field, token))
```

### 2b. Routes — `api/instances.py` (full file, `api/instances.py:1-146`)

```python
router = APIRouter(prefix="/api/workflows")                            # :46

class CreateInstanceRequest(BaseModel):                                # :49
    model_config = ConfigDict(extra="allow")
    context: dict = {}
    channel: Literal["staff", "family"]
    applicant_email: str | None = None

@router.post("/{tenant_id}/definitions/{definition_id}/instances", status_code=201)  # :57
def create_instance_route(tenant_id: str, definition_id: str, body: CreateInstanceRequest,
                          user: dict = Depends(require_staff_tenant)):  # :58-59
    # `definition_id` here is the LINEAGE id (stable across draft/published/
    # superseded versions), NOT a DataCore row entity_id — deliberately
    # disambiguated from :114's instance_entity_id param name (module
    # docstring :12-25). Runs `engine.create_instance`, then re-fetches the
    # flattened row and runs `machine.run_system_transitions` once before
    # responding (creation-time auto-advance fix, :70-91). Returns
    # {"instance": <flattened row>, "items": [...]}.

class ActionRequest(BaseModel):                                        # :108
    model_config = ConfigDict(extra="allow")
    action: str

@router.post("/{tenant_id}/instances/{instance_entity_id}/actions")    # :114
def instance_action_route(tenant_id: str, instance_entity_id: str, body: ActionRequest,
                          user: dict = Depends(require_staff_tenant)):  # :115-116
    # {instance_entity_id} IS a real DataCore entity_id here (unlike :57's
    # lineage id). Dispatches through machine.execute_action. ->
    # {"instance": row} plus "item" key when ctx.item_result is not None.
```

### 2c. Routes — `api/documents.py` (full file, `api/documents.py:1-99`) — staff surface

```python
router = APIRouter()                                                   # :41

class CreateDocumentRequest(BaseModel):                                # :44
    instance_id: str
    item_id: str | None = None
    filename: str
    content_type: str
    size: int
    sensitive: bool = False

@router.post("/documents/{tenant_id}", status_code=201)                # :67
def create_document(tenant_id: str, body: CreateDocumentRequest,
                    user=Depends(require_staff_tenant)):               # :68-69
    # POSTs to DataCore {"application_id": body.instance_id, "item_id",
    # "filename", "content_type", "size", "sensitive",
    # "uploaded_by": user["user_id"]}. `application_id` is DataCore's own
    # FIXED field name (:74) even though this module's own vocabulary is
    # instance_id. On non-2xx from DataCore: raises HTTPException with
    # DataCore's OWN status code but a fixed detail "Document create failed"
    # (status forwarded, body never forwarded — module docstring :16-22).

@router.get("/documents/{tenant_id}/{document_id}/url")                # :89
def get_document_url(tenant_id: str, document_id: str,
                     user=Depends(require_staff_tenant)):              # :90-91
    # same status-forwarded/body-masked convention as create_document.
```
Mounted in `main.py` with `prefix="/api"` (see 2f) — full paths are
`POST/GET /api/documents/{tenant_id}[...]`.

### 2d. Routes — `api/internal.py` (full file, `api/internal.py:1-443`) — family/token-scoped surface

Every route requires `X-Internal-Key` (whole router gated,
`api/internal.py:84`: `router = APIRouter(dependencies=[Depends(require_internal_key)])`).
No JWT anywhere in this module.

```python
BLOCKED_TOKEN_ACTIONS = frozenset({"cancel_instance", "verify_item", "reject_item", "waive_item"})  # :90

class StartRequest(BaseModel): context: dict = {}; applicant_email: str        # :96-98
class InternalActionRequest(BaseModel):                                        # :101
    model_config = ConfigDict(extra="allow")
    action: str
class RequestLinkRequest(BaseModel): email: str                                # :107-108
class TokenCreateDocumentRequest(BaseModel):                                   # :111
    item_id: str | None = None; filename: str; content_type: str; size: int; sensitive: bool = False
    # deliberately NO uploaded_by field (:112-114) — pydantic extra="ignore" drops any client-sent one

def resolve_token(token: str) -> tuple[str, dict]:                             # :128
    # decode+verify against CURRENT token_version; UNIFORM 401
    # ("Invalid or revoked link") on every failure mode — malformed token,
    # (tenant,instance) not found, revoked/stale signature — to avoid an
    # existence oracle (module docstring :24-38).

@router.post("/internal/workflows/{tenant_id}/{definition_id}/start", status_code=201)  # :202
def start_workflow(tenant_id: str, definition_id: str, body: StartRequest): ...        # :203
    # 404s (not 403) if the lineage has no published channel_access="family"
    # row. Creates instance, runs system auto-advance, mints+emails a magic
    # link. Returns {**result, "token": link_token, "link": link}.

@router.get("/internal/workflows/{tenant_id}/{definition_id}/config")          # :273
def workflow_config(tenant_id: str, definition_id: str): ...                   # :274
    # -> {"definition": {definition_id, name, version, machine (by_alias),
    #     steps (by_alias)}, "tenant": {tenant_id, name}, "capacity": {...}}

@router.post("/internal/workflows/{tenant_id}/request-link")                   # :293
def request_link(tenant_id: str, body: RequestLinkRequest, background_tasks: BackgroundTasks): ...  # :294
    # always -> {} (never discloses a match — anti-enumeration)

@router.get("/internal/instance-by-token/{token}")                             # :314
def instance_by_token(token: str): ...                                         # :315
@router.post("/internal/instance-by-token/{token}/actions")                    # :330
def action_by_token(token: str, body: InternalActionRequest): ...              # :331
    # 403 if body.action in BLOCKED_TOKEN_ACTIONS, else dispatches through
    # machine.execute_action same as :114's staff route.
@router.get("/internal/instance-by-token/{token}/documents")                   # :346
def documents_by_token(token: str): ...                                        # :347
@router.post("/internal/instance-by-token/{token}/documents", status_code=201) # :383
def create_document_by_token(token: str, body: TokenCreateDocumentRequest): ...  # :384
    # uploaded_by DERIVED as f"family:{instance_entity_id}" — never client-supplied.
    # On non-2xx from DataCore: masked to a FIXED 502 "Could not start the
    # upload. Please try again." — never DataCore's real status/body (module
    # docstring :56-63 — deliberately DIFFERENT convention from
    # api/documents.py's staff surface, which forwards the real status code).
@router.get("/internal/instance-by-token/{token}/documents/{document_id}/url")  # :406
def document_url_by_token(token: str, document_id: str): ...                   # :407
    # visibility: own upload OR non-sensitive (INTENTIONAL widening vs. the
    # pre-Task-10 familyhub behavior — see :412-421 comment)
```

### 2e. `Settings` — `config.py:27-121` (full class, verbatim)

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APEXFLOW_", case_sensitive=False)  # :28

    environment: str = "development"                                   # :30
    datacore_url: str = "http://localhost:5800"                        # :39
    cors_allowed_origins: Union[Optional[str], List[str]] = None       # :41
    port: int = 5910                                                   # :42
    link_secret: str = DEV_LINK_SECRET                                 # :51
    internal_key: str = DEV_INTERNAL_KEY                               # :52
    familyhub_base_url: str = "http://localhost:5620"                  # :59
    resend_api_key: str = ""                                           # :64
    email_from: str = "NeoApex Workflows <workflows@floatify.com>"     # :65
```
Every field above reads from env var `APEXFLOW_<FIELD_NAME_UPPER>` (e.g.
`datacore_url` <- `APEXFLOW_DATACORE_URL`) per `env_prefix="APEXFLOW_"`
(`:28`) — **there is no bare `DATACORE_URL` override for apexflow**, unlike
some sibling services. `parse_and_validate_cors` (`:67-90`) defaults CORS to
`["http://localhost:5900"]` in dev when unset (`:87`), and in production
requires `APEXFLOW_CORS_ALLOWED_ORIGINS` non-empty with no `"*"` (`:78-85`).
`validate_production_secrets` (`:92-118`) refuses to start in production if
`link_secret`/`internal_key` are still their dev defaults or shorter than
`MIN_SECRET_LENGTH = 32` (`:24`).

A load-bearing binding note is already in the file itself
(`config.py:32-38`): a prior task's brief called this field
`datacore_base_url`; the real name, ported verbatim from enrollx, is
`datacore_url`. Do not reintroduce the wrong name.

### 2f. `main.py` (full file, `main.py:1-46`)

```python
app = FastAPI(title="ApexFlow Backend", ...)                           # :23-28
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_allowed_origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])  # :30-36

app.include_router(definitions_api.router)                             # :38  (prefix /api/workflows, from the router itself)
app.include_router(instances_api.router)                               # :39  (prefix /api/workflows, from the router itself)
app.include_router(documents_api.router, prefix="/api")                # :40  (router itself has no prefix -> /api/documents/...)
app.include_router(internal_api.router)                                # :41  (router itself has no prefix -> /internal/...)

@app.get("/health")                                                    # :44
def health(): return {"status": "ok", "service": "apexflow-backend"}
```
Note: this file's own docstring (`main.py:4-12`) says "no business routers
exist yet, so this app only mounts a health check" — that is now stale; all
four routers are mounted. Trust the `include_router` calls, not the
docstring.

### 2g. `auth.py` (full file, `auth.py:1-124`)

```python
STAFF_ROLES = {"admin", "staff"}                                       # :27

def require_authenticated_user(request: Request) -> dict:              # :30
    # GET {settings.datacore_url}/auth/me with the caller's Authorization
    # header; 401 on missing/malformed header or non-2xx; 502 if DataCore
    # unreachable; returns user dict with `_token` = original header (:73).

def require_role(*roles: str):                                         # :77
    # factory; 403 if user["role"] not in roles

def require_staff_tenant(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:  # :99
    # 403 if role not in STAFF_ROLES OR user["tenant_id"] != tenant_id

def require_internal_key(x_internal_key: str | None = Header(default=None, alias="X-Internal-Key")) -> None:  # :112
    # hmac.compare_digest(x_internal_key, settings.internal_key); 401 on mismatch/missing
```
The module docstring (`:12-18`) notes `require_staff` (no-tenant-param
routes), `assert_query_tenant_match`, and the SQL-shape guard were NOT
ported here — apexflow has no `/api/query` route yet. A later task porting
one must copy the guard byte-identical per §5's `_GUARD_FILES` mechanism.
Also load-bearing (`:91-98`): this dependency's real name is
`require_staff_tenant`, not `require_tenant_match` (a name from a different
service, `admindash/backend/app/tenancy.py:290`).

### 2h. `workflows/validate.py` — param-validator table (copied verbatim, safety-critical)

Source: `apexflow/backend/app/workflows/validate.py`. Primitive catalogs
are DERIVED from `workflows/primitives.py`'s own registries so the two
cannot drift (`validate.py:36-44`):
```python
GUARD_PRIMITIVES: frozenset[str] = frozenset(GUARDS)                   # validate.py:42
EFFECT_PRIMITIVES: frozenset[str] = frozenset(EFFECTS)                 # validate.py:44
```
`GUARDS` and `EFFECTS` themselves (`workflows/primitives.py:290-297,590-597`):
```python
GUARDS: dict[str, Callable[[EvalContext, dict], bool]] = {             # primitives.py:290
    "all_blocking_items_complete": _guard_all_blocking_items_complete,
    "items_in_status": _guard_items_in_status,
    "capacity_available": _guard_capacity_available,
    "data_condition": _guard_data_condition,
    "date_window": _guard_date_window,
    "actor_role": _guard_actor_role,
}
EFFECTS: dict[str, Callable[[EvalContext, dict], None]] = {            # primitives.py:590
    "commit_sections": _effect_commit_sections,
    "set_entity_field": _effect_set_entity_field,
    "send_email": _effect_send_email,
    "issue_link": _effect_issue_link,
    "start_due_clocks": _effect_start_due_clocks,
    "set_context": _effect_set_context,
}
```

**The param-validator tables** (only primitives with a real required-param
shape get an entry — `all_blocking_items_complete` and `issue_link` take no
params to validate, per `validate.py:299-302`'s comment):

```python
GUARD_PARAM_VALIDATORS: dict[str, Callable[[dict], list[str]]] = {     # validate.py:393
    "items_in_status": _guard_params_items_in_status,
    "capacity_available": _guard_params_capacity_available,
    "data_condition": _guard_params_data_condition,
    "date_window": _guard_params_date_window,
    "actor_role": _guard_params_actor_role,
}

EFFECT_PARAM_VALIDATORS: dict[str, Callable[[dict], list[str]]] = {    # validate.py:442
    "commit_sections": _effect_params_commit_sections,
    "set_entity_field": _effect_params_set_entity_field,
    "send_email": _effect_params_send_email,
    "set_context": _effect_params_set_context,
}
```
`start_due_clocks` is special-cased OUTSIDE `EFFECT_PARAM_VALIDATORS`
(`validate.py:474-476`: `if primitive == "start_due_clocks": return
_effect_params_start_due_clocks(params, declared_step_ids)`) because its
`step_ids` need cross-referencing against the definition's *declared* step
ids, not just shape-checking in isolation (`validate.py:450-455`).

Required/optional params, per validator function (verbatim logic, not
paraphrased):

| primitive | kind | required params | optional params | source |
|---|---|---|---|---|
| `all_blocking_items_complete` | guard | — (no param validation) | — | primitives.py GUARDS only |
| `items_in_status` | guard | `status` (str, or non-empty list of str) | `quantifier` (must be `"all"`/`"any"` if present), `step_ids` (must be a list if present) | validate.py:309-333 |
| `capacity_available` | guard | `count_states` (non-empty list), `capacity_field` (str) | — | validate.py:336-348 |
| `data_condition` | guard | `condition` (must parse as `ConditionGroup.model_validate`) | — | validate.py:351-359 |
| `date_window` | guard | at least one of `start`/`end`; each present one must be `YYYY-MM-DD` | `start`, `end` (either may be omitted, not both) | validate.py:362-383 |
| `actor_role` | guard | `roles` (non-empty list) | — | validate.py:386-390 |
| `issue_link` | effect | — (no param validation) | — | primitives.py EFFECTS only |
| `commit_sections` | effect | `section_ids` (non-empty list) | — | validate.py:402-406 |
| `set_entity_field` | effect | `ref` (str), `field` (str) | — (but: if `ref == "instance"`, `field` must NOT be in `ENGINE_OWNED_FIELDS` — validate.py:417-425) | validate.py:409-426 |
| `send_email` | effect | `template` (str) | — | validate.py:429-433 |
| `set_context` | effect | `key` (truthy) | — | validate.py:436-439 |
| `start_due_clocks` | effect (special-cased) | `step_ids` (non-empty list; each id must be a declared `StepDef.step_id`) | — | validate.py:450-464 |

This table is the exact binding the frontend primitive catalog must match —
do not add/rename/reshape any param without updating `validate.py` first
(the frontend catalog is downstream of it, not the other way around).

### 2i. `workflows/schema.py` — TS-relevant shapes (full relevant excerpts, verbatim)

Source: `apexflow/backend/app/workflows/schema.py:1-224` (full file).
Module docstring (`:18-22`) states the naming convention explicitly:
`from_`/`all_`/`any_`/`not_` trail an underscore because `from`, `all`,
`any`, `not` are Python keywords/builtins; `populate_by_name=True` +
`Field(alias=...)` lets each model construct from either name, and
`model_dump(by_alias=True)` emits the wire-format (JSON) key — this is what
the TS mirror types must match on the wire.

```python
ENGINE_OWNED_FIELDS: frozenset[str] = frozenset({                      # :32-48
    "instance_id", "workflow_instance_id", "definition_id",
    "definition_version", "state", "subject_refs", "context",
    "channel_started", "applicant_email", "token_version",
    "draft_data", "opened_at", "closed_at",
})

class Condition(BaseModel):                                            # :54
    model_config = ConfigDict(populate_by_name=True)
    source: str
    op: Literal["eq", "ne", "in", "empty", "not_empty", "truthy"]
    value: Any = None
    # @model_validator: op="in" requires value to be a list (:69-86)

ConditionItem = Union[Condition, "ConditionGroup"]                     # :92

class ConditionGroup(BaseModel):                                       # :95
    model_config = ConfigDict(populate_by_name=True)
    all_: list[ConditionItem] | None = Field(default=None, alias="all")  # :105
    any_: list[ConditionItem] | None = Field(default=None, alias="any")  # :106
    not_: list[ConditionItem] | None = Field(default=None, alias="not")  # :107
    # @model_validator: exactly one of all_/any_/not_ must be non-None (:109-117)

class StateDef(BaseModel):                                             # :126
    model_config = ConfigDict(populate_by_name=True)
    state_id: str
    name: str
    kind: Literal["initial", "active", "terminal"]

class GuardRef(BaseModel):                                             # :134
    model_config = ConfigDict(populate_by_name=True)
    primitive: str
    params: dict[str, Any] = Field(default_factory=dict)

class EffectRef(BaseModel):                                            # :144
    model_config = ConfigDict(populate_by_name=True)
    primitive: str
    params: dict[str, Any] = Field(default_factory=dict)

class TransitionDef(BaseModel):                                        # :154
    model_config = ConfigDict(populate_by_name=True)
    transition_id: str
    from_: str = Field(alias="from")                                   # :158  <-- exact alias spelling
    to: str
    action: str
    actor: Literal["family", "staff", "system"]
    guards: list[GuardRef] = Field(default_factory=list)
    effects: list[EffectRef] = Field(default_factory=list)

class MachineDef(BaseModel):                                           # :166
    model_config = ConfigDict(populate_by_name=True)
    states: list[StateDef]
    transitions: list[TransitionDef]

class FieldPick(BaseModel):                                            # :176
    model_config = ConfigDict(populate_by_name=True)
    name: str
    required: bool

class RepeatSpec(BaseModel):                                           # :183
    model_config = ConfigDict(populate_by_name=True)
    min: int
    max: int

class SectionDef(BaseModel):                                           # :193
    model_config = ConfigDict(populate_by_name=True)
    section_id: str
    entity_model: str
    fields: list[FieldPick]
    mode: Literal["create", "match_or_create"]
    repeat: RepeatSpec | None = None

class StepDef(BaseModel):                                              # :203
    model_config = ConfigDict(populate_by_name=True)
    step_id: str
    type: Literal["form", "documents", "message"]
    title: str
    required: bool
    blocking: bool
    available_in: list[str]
    show_if: ConditionGroup | None = None
    review: Literal["staff", "auto"] | None = None                     # :222  None = "use type's semantic default" (form/message -> auto, documents -> staff), NOT applied by this schema itself
    config: dict[str, Any] = Field(default_factory=dict)
```

**Exact alias spellings for the TS mirrors (the brief's specific
concern):** `TransitionDef.from_` -> wire key `"from"` (`Field(alias="from")`,
`:158`). `ConditionGroup.all_`/`any_`/`not_` -> wire keys `"all"`/`"any"`/`"not"`
(`:105-107`). Every model has `populate_by_name=True`, so a TS type author
can pick either the Python name or the alias as long as the wire format
(what `model_dump(by_alias=True)` emits, and what the TS side must send
back) uses the alias spelling exactly (`from`/`all`/`any`/`not`, no
trailing underscore).

---

## 3. `templates/enrollment.py` — definition dict shape + seed signature

Source: `apexflow/backend/app/templates/enrollment.py` (488 lines, read in
full).

```python
DEFINITION_ID = "enrollment"                                           # :142
DEFINITION_NAME = "Enrollment"                                         # :143

def build_machine() -> dict:                                           # :331
    return {"states": _states(), "transitions": _transitions()}

def build_steps() -> list[dict]:                                       # :457
    return _steps()

def seed_enrollment_template(tenant_id: str, *, token: str | None = None) -> dict[str, Any]:  # :464
```

**Section dict shape** (four section builders, `:338-411`) — every section
is `{"section_id": str, "entity_model": str, "mode": "create"|"match_or_create",
"fields": [{"name": str, "required": bool}, ...], "repeat": None | {"min": int, "max": int}}`.
Concrete instances:
- `_family_section()` (`:338-356`) — `entity_model: "family"`, `mode: "match_or_create"`, 12 fields, `repeat: None`.
- `_student_section()` (`:359-376`) — `entity_model: "student"`, `mode: "create"`, 11 fields, `repeat: None`.
- `_contacts_section()` (`:379-393`) — `entity_model: "contact"`, `mode: "create"`, 8 fields, `repeat: {"min": 1, "max": 5}`.
- `_application_section()` (`:396-411`) — `entity_model: "registration_application"`, `mode: "create"`, 9 fields, `repeat: None`.

**Step dict shape** (`_steps()`, `:414-454`) — every step is
`{"step_id", "type", "title", "required": bool, "blocking": bool,
"available_in": list[str], "show_if": None|ConditionGroup-shaped-dict,
"review": None|"staff"|"auto", "config": dict}`. Four steps in the template:
`welcome` (message), `application_form` (form, `config.sections` = the four
section dicts above, `review: "staff"` overriding the form-type default),
`documents` (documents, `config.docs` = list of doc requirement dicts,
`review: None` defaulting to staff), `review_notice` (message).

**`seed_enrollment_template` body** (`:476-487`):
```python
base = {
    "definition_id": DEFINITION_ID, "name": DEFINITION_NAME, "version": 1,
    "status": "draft", "lineage_status": "active", "channel_access": "family",
    "machine": json.dumps(build_machine()), "steps": json.dumps(build_steps()),
}
created = dc.dc_create(tenant_id, "workflow_definition", base, token)
return defs.publish_definition(tenant_id, created["entity_id"], token)
```
`machine`/`steps` are stored as JSON-encoded strings (matching
`base_model.json`'s `workflow_definition.machine`/`.steps` fields being
`type: "str"` — see §8), not nested objects — the designer must
`JSON.parse`/`json.dumps` at the same boundary. Note `channel_access:
"family"` (`:482`) is a valid option but NOT the model's own default
(`"staff_only"` — see §8's note on this).

---

## 4. flow-runtime

Source: `flow-runtime/package.json` (18 lines, full), `flow-runtime/src/index.ts`
(10 lines, full), `flow-runtime/tsconfig.json` (13 lines, full).

```json
{
  "name": "@neoapex/flow-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": { "react": "^19.0.0" },
  "devDependencies": { "typescript": "~5.9.0", "@types/react": "^19.0.0" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

```ts
// flow-runtime/src/index.ts — full current exports
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
export { flowT, flowTWith, useFlowT, useFlowLocale, type Locale } from './i18n';
export { validateFlowField } from './validateField';
export {
  formFields, docsOf, plansOf, planAmounts, messageBody,
  resolvePlanKind, paymentAmountFor,
  defaultSchoolYear, hydratedFormFields, type ModelFieldSource,
} from './blockConfig';
export { formatCents } from './money';
```

**Build/consumption mechanism: there is no build step.** `main`/`types`
point straight at `src/index.ts` (raw TypeScript source, not a `dist/`
output); `tsconfig.json` has `"noEmit": true` and
`"moduleResolution": "bundler"`; the only npm script is `typecheck`.
Consumers (Vite/esbuild) resolve the raw `.ts`/`.tsx` files directly.

**familyhub's consumption** — `familyhub/frontend/package.json:13`:
```json
"@neoapex/flow-runtime": "file:../../flow-runtime",
```
an npm `file:` link, no registry publish. `familyhub/frontend/vite.config.ts`
has no flow-runtime-specific handling — the `file:` link is what makes
resolution work. Import sites, verbatim:
- `familyhub/frontend/src/api/facade.ts:2` — `import type { RegistrationConfigDef, FlowBlock } from '@neoapex/flow-runtime';`
- `familyhub/frontend/src/pages/LandingPage.tsx:1` — `import type { RegistrationConfigDef } from '@neoapex/flow-runtime';` (a deliberate type-only "smoke import" that locks the dependency in CI, per the file's own comment)
- `familyhub/frontend/src/pages/HubPage.tsx:3-8` — `import { DONE_ITEM_STATUSES, formatCents, paymentAmountFor, type ApplicationItem } from '@neoapex/flow-runtime';`
- `familyhub/frontend/src/types/registration.ts:1,6` — `import type { RegistrationConfigDef, FlowBlock } from '@neoapex/flow-runtime';` and `export type { ApplicationStatus, ItemStatus } from '@neoapex/flow-runtime';` (re-export, not redeclare, to avoid drift)
- `familyhub/frontend/src/pages/RegisterPage.tsx:3-4` — `import { FlowRenderer, defaultSchoolYear } from '@neoapex/flow-runtime';` and `import type { ApplicationItem, ApplicationSummary } from '@neoapex/flow-runtime';`

**Constraint for later Plan 2 tasks:** any change to
`flow-runtime/package.json` or `tsconfig.json` (e.g. adding a real build
step, changing `main`) must preserve raw-TS resolution or familyhub's Vite
dev/build breaks. Do not add a `dist/` build without updating both
`package.json`'s `main` AND verifying familyhub's Vite config still
resolves it.

---

## 5. DataCore generic routes + SQL guard + models read

### 5a. Entity/tenant/model routes

Source: `datacore/src/datacore/api/routes.py`, all registered inside
`register_routes(app, store)` (`:67`):

```python
class CreateEntityRequest(BaseModel): base_data: dict; custom_fields: dict | None = None  # :35-37
class TenantRequest(BaseModel): base_data: dict; custom_fields: dict | None = None         # :40-42

@app.put("/api/tenants/{tenant_id}")                                    # :70
def put_tenant(tenant_id: str, body: TenantRequest): ...                # :71

@app.get("/api/entities/{tenant_id}/{entity_type}/next-id")             # :93
def next_entity_id(tenant_id: str, entity_type: str): ...               # :94
    # 400 if entity_type not in DEFAULT_ABBREVS (:20-32)

class SimilaritySearchRequest(BaseModel):                               # :125
    first_name: str; last_name: str; dob: str; primary_address: str

@app.post("/api/entities/{tenant_id}/student/duplicate-check")          # :131
def duplicate_check(tenant_id: str, body: SimilaritySearchRequest): ... # :132

class PutModelsRequest(BaseModel):                                      # :200
    model_definition: dict; source_filename: str; created_by: str

@app.put("/api/models/{tenant_id}")                                     # :205
def put_tenant_models(tenant_id: str, body: PutModelsRequest): ...      # :206

class ArchiveRequest(BaseModel): entity_ids: list[str]                  # :274-275

@app.post("/api/entities/{tenant_id}/{entity_type}/archive")            # :277
def archive_entities(tenant_id: str, entity_type: str, body: ArchiveRequest): ...  # :278

@app.post("/api/entities/{tenant_id}/{entity_type}/restore")            # :285
def restore_entities(tenant_id: str, entity_type: str, body: ArchiveRequest): ...  # :286

@app.put("/api/entities/{tenant_id}/{entity_type}/{entity_id}")         # :294
def update_entity(tenant_id: str, entity_type: str, entity_id: str, body: CreateEntityRequest): ...  # :295-297

@app.post("/api/entities/{tenant_id}/{entity_type}")                    # :310
def create_entity(tenant_id: str, entity_type: str, body: CreateEntityRequest): ...  # :311-313

@app.get("/api/search/{tenant_id}")                                     # :356
def search_entities(tenant_id: str, q: str = Query(...), entity_type: str | None = Query(None),
                    limit: int = Query(10, ge=1, le=100)): ...          # :357-362
```

### 5b. Query routes

**There is no dedicated `GET /api/models` route.** Model definitions are
read through the unified query endpoint with `table: "models"`, not a
separate endpoint — correct the brief's "models read route" wording to
point here:

```python
# datacore/src/datacore/api/unified_routes.py
class TableName(str, Enum): entities = "entities"; models = "models"; tenants = "tenants"  # :16-19
class QueryRequest(BaseModel): tenant_id: str; table: TableName; sql: str                   # :22-25

@router.post("/api/query")                                              # :34
def unified_query(req: QueryRequest): ...                               # :35
    # runs with external=True (DuckDB enable_external_access off);
    # duckdb.PermissionException -> 400; Catalog/Parser/Binder Error -> 400;
    # else 500. Returns {"data": [...], "total": n}.
```

```python
# datacore/src/datacore/api/readonly_query.py
READONLY_MAX_ROWS = 200                                                 # :27
class TableName(str, Enum): entities = "entities"; models = "models"; tenants = "tenants"  # :294-297 (locally redefined, identical values)
class ReadOnlyQueryRequest(BaseModel): tenant_id: str; table: TableName; sql: str            # :300-303

@router.post("/api/query/readonly")                                     # :323
def readonly_query(req: ReadOnlyQueryRequest): ...                      # :324
    # wraps clean SQL as `SELECT * FROM ({clean}) AS _q`, caps at
    # READONLY_MAX_ROWS, strips "vector" from each returned row.
```

### 5c. The shared SQL shape guard (safety-critical, verbatim block)

Source: `datacore/src/datacore/api/readonly_query.py:30-291` — the
literal block between the markers
`# ── BEGIN shared SQL shape guard ──` and
`# ── END shared SQL shape guard ──`. This file's own header comment
(`:7-12`) states it is the SOURCE OF TRUTH; the block is copied verbatim
into `admindash/backend/app/tenancy.py`, and I confirmed both copies are
byte-identical (read both files directly — `admindash/backend/app/api/entities.py`
and `.../query.py` were also read in full, see §6). Key pieces, exact:

```python
_DENY = re.compile(                                                     # :42-45
    r"\b(read_\w+|write_\w*|\w*_scan|scan_\w+|\w*_attach|glob|sniff_csv|system)\s*\(",
    re.IGNORECASE,
)
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_]\w*)?\$")                      # :49
_IDENT_CHAR = re.compile(r"\w")                                         # :50
_PLAIN_IDENT = re.compile(r"[A-Za-z_]\w*\Z")                            # :51
_STR = "''"                                                             # :55
_TOKEN = re.compile(r"''|[A-Za-z_]\w*|\S", re.DOTALL)                   # :57

_QUERY_PAREN_PREV = frozenset({                                         # :63-68
    "all", "and", "any", "as", "between", "by", "case", "distinct", "else",
    "except", "exists", "from", "having", "ilike", "in", "intersect", "is",
    "join", "lateral", "like", "not", "on", "or", "returning", "select",
    "then", "union", "using", "values", "when", "where", "with",
})
_FROM_CLAUSE_END = frozenset({                                          # :72-76
    "except", "group", "having", "intersect", "limit", "offset", "on",
    "order", "qualify", "returning", "select", "union", "using", "where",
    "window",
})

def _strip_literals_and_comments(sql: str) -> str: ...                  # :79-182
    # blanks '...'/"..."/`...`/$tag$...$tag$ literals and --/‌/* */ comments
    # to a `''` placeholder so the deny-scan sees only SQL code; raises
    # ValueError on an unterminated literal/comment/identifier (refuse
    # rather than guess — a desynced scanner is exactly how this kind of
    # guard gets bypassed).

def _sql_shape_error(sql: str) -> str | None: ...                       # :185-290
    # three checks, in order: (1) single statement starting SELECT/WITH
    # (leading "(" allowed); (2) no _DENY match anywhere; (3) no string
    # literal in table-reference position (blocks `FROM '/etc/passwd'`
    # style DuckDB replacement-scan file reads). Write/DDL keywords are
    # rejected by (1) alone (DuckDB accepts them as identifiers, so no
    # bare-word denylist).
```

Defense in depth, NOT the authoritative control — the file's own docstring
(`:7-12`) states the authoritative control is `QueryEngine.query(...,
external=True)` (DuckDB's `enable_external_access=false`), true regardless
of what the guard did or didn't catch.

### 5d. `_GUARD_FILES` — both copies (verified identical)

```python
# datacore/tests/test_readonly_query.py:184-187
_GUARD_FILES = (
    "datacore/src/datacore/api/readonly_query.py",
    "admindash/backend/app/tenancy.py",
)
```
```python
# admindash/backend/tests/test_tenancy.py:290-293
_GUARD_FILES = (
    "datacore/src/datacore/api/readonly_query.py",
    "admindash/backend/app/tenancy.py",
)
```
Both test files slice each file between the literal markers
`"# ── BEGIN shared SQL shape guard"` / `"# ── END shared SQL shape guard"`
and assert byte equality (`test_readonly_query.py:217-229` and the
equivalent block in `test_tenancy.py`, ~`:323-335`).

**This is exactly the drift-detection mechanism this map's opening section
warns about.** If apexflow-backend ever proxies `/api/query` (a query-proxy
route for the designer would need to), it becomes a THIRD copy of this
guard. Either import one of the two existing files directly (no new copy),
or add `apexflow/backend/app/...` to BOTH `_GUARD_FILES` tuples and extend
both byte-identity tests — do not add a fourth silent copy.

---

## 6. admindash-backend generic proxy routes (Task 1 porting source)

### 6a. `admindash/backend/app/api/entities.py` (full file, 128 lines, read directly)

```python
async def _proxy_to_datacore(method: str, path: str, request: Request, token: str) -> Response:  # :11-13
    # forwards body (if POST/PUT/PATCH), Content-Type, Authorization; on
    # httpx.RequestError -> 502 "DataCore is unreachable"; else relays
    # DataCore's status/content/content-type verbatim.

@router.post("/entities/{tenant_id}/{entity_type}")                     # :40
async def create_entity(tenant_id, entity_type, request, user=Depends(require_tenant_match)): ...  # :41-45

@router.post("/entities/{tenant_id}/{entity_type}/archive")             # :53
async def archive_entities(...): ...

@router.post("/entities/{tenant_id}/{entity_type}/restore")             # :68
async def restore_entities(...): ...

@router.get("/entities/{tenant_id}/{entity_type}/next-id")              # :83
async def next_id(...): ...

@router.post("/entities/{tenant_id}/{entity_type}/duplicate-check")     # :98
async def duplicate_check(...): ...

@router.put("/entities/{tenant_id}/{entity_type}/{entity_id}")          # :114
async def update_entity(...): ...
```
Route ORDER matters (file's own comments, `:52`, `:113`): the specific
suffixed routes (`/archive`, `/restore`, `/next-id`, `/duplicate-check`)
are registered before the generic `/{entity_id}` catch-all so FastAPI
matches the specific ones first.

### 6b. `admindash/backend/app/api/query.py` (full file, 53 lines, read directly)

```python
@router.post("/query")                                                  # :12
async def query(request: Request, user=Depends(require_authenticated_user)):  # :13-14
    # reads raw body AND parses JSON separately (both needed: raw for the
    # forward, parsed for the two checks below); 400 if body isn't valid
    # JSON or isn't an object.
    assert_query_tenant_match(payload.get("tenant_id"), user)           # :30
    assert_sql_is_safe_read(payload.get("sql", ""))                     # :31
    # then forwards raw body to POST {settings.datacore_url}/api/query,
    # relays response verbatim (same 502-on-unreachable convention as entities.py).
```
`assert_query_tenant_match` and `assert_sql_is_safe_read` (imported from
`app.tenancy`) live in the same `tenancy.py` module that carries the SQL
guard block (§5c/§5d) — `require_tenant_match` (used by `entities.py`) is
also defined there, at `admindash/backend/app/tenancy.py:290`.

---

## 7. Configuration-facts table

Every port, URL, env var, localStorage key, and `services.json` entry the
designer touches. Verified directly against the files on disk (not from
memory or from any injected/cached description of them) — cross-checked
`git log -p -- services.json` to confirm the current values are the latest
committed state, not a stale intermediate one.

| Fact | Value | Source (file:line) |
|---|---|---|
| `services.json` — `apexflow-frontend` | `{"host": "localhost", "port": 5900}` | `services.json:12` |
| `services.json` — `apexflow-backend` | `{"host": "localhost", "port": 5910}` | `services.json:13` |
| `services.json` — `admindash-frontend` | `{"host": "localhost", "port": 5600}` | `services.json:5` |
| `services.json` — `admindash-backend` | `{"host": "localhost", "port": 5610}` | `services.json:6` |
| `services.json` — `familyhub-frontend` | `{"host": "localhost", "port": 5620}` | `services.json:7` |
| `services.json` — `familyhub-backend` | `{"host": "localhost", "port": 5630}` | `services.json:8` |
| `services.json` — `datacore` | `{"host": "localhost", "port": 5800}` | `services.json:11` |
| apexflow-backend `port` default | `5910` | `apexflow/backend/app/config.py:42` |
| apexflow-backend `datacore_url` default | `http://localhost:5800` | `apexflow/backend/app/config.py:39` |
| apexflow-backend `familyhub_base_url` default | `http://localhost:5620` | `apexflow/backend/app/config.py:59` |
| apexflow-backend env prefix | `APEXFLOW_` (all Settings fields read `APEXFLOW_<FIELD>`) | `apexflow/backend/app/config.py:28` |
| apexflow-backend CORS env var (production-required) | `APEXFLOW_CORS_ALLOWED_ORIGINS` | `apexflow/backend/app/config.py:80,84` |
| apexflow-backend CORS dev default | `["http://localhost:5900"]` | `apexflow/backend/app/config.py:87` |
| admindash-backend `datacore_url` default | `http://localhost:5800` | `admindash/backend/app/config.py:15` |
| admindash-backend CORS env var | `ADMINDASH_CORS_ALLOWED_ORIGINS` | `admindash/backend/app/config.py:41,46` |
| familyhub-backend `datacore_url` default | `http://localhost:5800` | `familyhub/backend/app/config.py:13` |
| familyhub-backend CORS env var | `FAMILYHUB_CORS_ALLOWED_ORIGINS` | `familyhub/backend/app/config.py:40,44` |
| datacore JWT secret env var | `DATACORE_JWT_SECRET` (dev default `neoapex-dev-secret-change-in-prod`) | `datacore/src/datacore/auth/config.py:12` |
| datacore JWT expiry env var | `DATACORE_JWT_EXPIRY_HOURS` (default `24`) | `datacore/src/datacore/auth/config.py:15` |
| datacore CORS env var (unprefixed) | `CORS_ALLOWED_ORIGINS` | `datacore/src/datacore/api/__init__.py:29,34,39` |
| admindash-frontend `ADMINDASH_API_URL` | `import.meta.env.VITE_ADMINDASH_API_URL \|\| svcUrl("admindash-backend")` | `admindash/frontend/src/config.ts:8-9` |
| familyhub-frontend `FAMILYHUB_API_URL` | `import.meta.env.VITE_FAMILYHUB_API_URL \|\| svcUrl("familyhub-backend")` | `familyhub/frontend/src/config.ts:8-9` |
| `VITE_ADMINDASH_API_URL` (frontend override env) | — | `admindash/frontend/src/config.ts:9` |
| `VITE_FAMILYHUB_API_URL` (frontend override env) | — | `familyhub/frontend/src/config.ts:9` |
| localStorage: JWT token | key `neoapex_token` | `admindash/frontend/src/contexts/AuthContext.tsx:4`; also `admindash/backend`-adjacent frontends `launchpad/frontend/src/api/client.ts:5`, `papermite/frontend/src/api/client.ts:15` (each an independent copy of the same literal, not shared code) |
| localStorage: locale | key `preferredLanguage` | `admindash/frontend/src/hooks/useTranslation.ts:4`; `familyhub/frontend/src/hooks/useTranslation.ts:4`; also read directly (not via the hook) at `flow-runtime/src/i18n.ts:87` |
| localStorage: admindash density | key `admindash_density` | `admindash/frontend/src/hooks/useDensity.ts:3` |
| sessionStorage: admindash chat history | key `admindash_chat_history` | `admindash/frontend/src/contexts/AuthContext.tsx:63` |
| DataCore models write route | `PUT /api/models/{tenant_id}` | `datacore/src/datacore/api/routes.py:205` |
| DataCore models read | via `POST /api/query {table: "models"}` — no dedicated GET route exists | `datacore/src/datacore/api/unified_routes.py:34` |
| `start-services.sh` apexflow port var names | `APEXFLOW_BE_PORT`, `APEXFLOW_FE_PORT` (read from `services.json` via `read_port`) | `start-services.sh:53,58` |
| apexflow-frontend directory | does not exist yet as of this map — `start-services.sh` guards against it | `start-services.sh:277-278` |

**Confirmed live discrepancy caught during this task's research:** this
task's own injected/cached project context (a prior snapshot of
`CLAUDE.md`) described FamilyHub as `React frontend (port 6000) + Python
FastAPI backend (port 6010)`. The actual repository state — both
`services.json:7-8` and the current `CLAUDE.md:14,73-74` on disk — has
FamilyHub at **5620/5630**. `git log -p -- services.json` confirms 5620/5630
is the latest committed value (two ports migrations: `6000→8080` then
`8080/6010→5620/5630`, commits `c9547d9` and `d4d5f5e`). This map's
port/URL facts above were all re-verified against the files on disk, not
against any cached/injected description — this is precisely the
Plan-1-style stale-constant failure mode this map exists to prevent, and it
would have reproduced here had the config-facts table been written from
the injected context instead of from `services.json`/`config.py` directly.

---

## 8. `base_model.json` — `workflow_definition` field list

Source: `launchpad/backend/app/data/base_model.json:151-163` (full,
verbatim):

```json
"workflow_definition": {
  "base_fields": [
    {"name": "definition_id", "type": "str", "required": true},
    {"name": "name", "type": "str", "required": true},
    {"name": "version", "type": "number", "required": true},
    {"name": "status", "type": "selection", "required": true, "options": ["draft", "published", "superseded"], "default": "draft"},
    {"name": "lineage_status", "type": "selection", "required": true, "options": ["active", "deprecated", "retired"], "default": "active"},
    {"name": "channel_access", "type": "selection", "required": true, "options": ["staff_only", "family"], "default": "staff_only"},
    {"name": "machine", "type": "str", "required": true},
    {"name": "steps", "type": "str", "required": true}
  ],
  "custom_fields": []
}
```
`machine` and `steps` are `type: "str"` — stored as JSON-encoded strings
(matching §3's `json.dumps(build_machine())`/`json.dumps(build_steps())`),
not nested JSON objects; the designer must parse/stringify at read/write
time, same as `templates/enrollment.py` does. `channel_access`'s model
default is `"staff_only"`; the enrollment template seeds `"family"`
(§3) — a valid option, not the default, so any draft-row UI defaulting a
new definition's `channel_access` should default to `"staff_only"` per the
model, not silently assume `"family"`.

For reference, the adjacent `workflow_instance` base fields
(`base_model.json:164-180`) are: `instance_id` (implicit via `entity_id`,
not itself a base_field — the entity's own DataCore-assigned id),
`definition_id`, `definition_version`, `state`, `subject_refs`, `context`,
`channel_started`, `applicant_email`, `token_version` (default `1`),
`draft_data`, `opened_at`, `closed_at` — this set matches
`workflows/schema.py`'s `ENGINE_OWNED_FIELDS` (§2i) minus `instance_id`/
`workflow_instance_id`, confirming those two are the section-writable ban
list's synthetic/self-referential entries rather than literal
`workflow_instance` base_fields.

---

## Cross-cutting notes for later tasks

1. **No exchange-code flow to port from admindash-frontend** (§1a). If the
   designer needs cross-service auth handoff, port from
   `launchpad/frontend/src/api/client.ts` instead.
2. **admindash-frontend's api client has no structured error shape** (§1d)
   — every call throws a bare `Error('HTTP ${status}')`; there is nothing
   richer to port.
3. **i18n file layout is a single `translations.ts`, not per-locale JSON**
   (§1e) — `admindash/CLAUDE.md`'s own description of this is stale;
   trust the file on disk.
4. **No `api/actions.py`/`api/model-impact.py` files** (§2) — those routes
   live inside `api/definitions.py` and `api/instances.py`.
5. **No dedicated `GET /api/models` route in DataCore** (§5b) — models are
   read via `POST /api/query {table: "models"}`.
6. **A third copy of the SQL guard is a drift risk** (§5c/§5d) — if
   apexflow-backend proxies `/api/query`, extend `_GUARD_FILES` in both
   existing test files rather than adding a silent fourth copy.
7. **flow-runtime has no build step** (§4) — preserve raw-TS `file:`
   resolution or familyhub's Vite build breaks.
8. **apexflow-backend's `main.py` docstring is stale** (§2f) — it claims no
   business routers are mounted; all four (`definitions`, `instances`,
   `documents`, `internal`) already are.
