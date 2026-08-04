# Registration Phase 1 — Plan 4: Flow Builder & Staff Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flow-runtime placeholder with the real FlowRenderer and its six block components, and build the staff side of registration in enrollx-frontend: a Flow Builder with live preview and publish, staff-assisted application entry, and the tracking views (applications pipeline + application detail). Everything consumes backend endpoints that already exist after Plans 1–3; this plan adds **zero** backend code.

**Architecture:** `flow-runtime` (shared package, sibling of `ui-tokens`) owns the flow-walking renderer and block components; it is consumed here by enrollx (staff entry, builder live preview) and later by familyhub (Plan 5, parent runtime) — one implementation, two hosts. enrollx-frontend hosts the builder and tracking pages. All reads go through the generic query proxy (`POST /api/query` → DataCore SQL over the tenant's entities); invariant-free writes (builder drafts) use the generic entity proxy; lifecycle writes go through the single action endpoint from Plan 2. Entity-model-sourced form fields are resolved by the HOST app (via ModelContext) and injected into block config before the config reaches FlowRenderer — flow-runtime never fetches anything.

**Tech Stack:** React 19 + TypeScript + Vite (enrollx-frontend, port 5900); TypeScript-only npm package `@neoapex/flow-runtime` (typechecked with `tsc --noEmit`, compiled by the host's Vite); native Fetch; CSS variables from `@neoapex/ui-tokens` (no CSS-in-JS); enrollx-backend (FastAPI, port 5910) is consumed, not modified.

## Global Constraints

- **Branch:** `git checkout main && git pull` then `git checkout -b feat/registration-plan4-builder-staff`. Commit per task. SSH remotes only.
- **No frontend test framework exists in this repo.** Verification for every task is: `cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck`, `cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build` (tsc + Vite) and `npm run lint`, plus the concrete manual smoke steps in Task 11. Do not invent a test runner.
- **Do not modify any backend** (`enrollx/backend`, `datacore`, `launchpad`, `familyhub`). If a backend contract seems wrong, re-check with the greps in Task 0 and adapt the frontend call — never the backend.
- **Keep flow-runtime's exported names**: `FlowRenderer`, `FlowRendererProps`, `BlockType`, `FlowBlock`, `RegistrationConfigDef`, `FlowMode` (Plan 1 contract; Plan 5 imports them).
- **Binding contracts consumed** (from the roadmap `docs/superpowers/plans/2026-08-03-registration-phase1-roadmap.md` and Plans 2–3):
  - `POST /api/registration/{tenant_id}/applications` body `{program_id, school_year, channel: "parent"|"admin", applicant_email?}` → 201 application entity.
  - `POST /api/registration/{tenant_id}/applications/{application_id}/actions` body `{"action": <name>, ...params}`; names used here: `save_draft, complete_item, submit, approve, decline, request_changes, verify_item, reject_item, waive_item, record_offline_payment, promote_waitlist, publish_config, resend_link`.
  - `POST /api/registration/{tenant_id}/applications/{application_id}/checkout` → JSON containing a Stripe Checkout URL (Plan 3).
  - Document proxies: `POST /api/documents/{tenant_id}` body `{application_id, item_id?, filename, content_type, size, sensitive}` → `{document_id, upload_url, storage_key}`; `GET /api/documents/{tenant_id}/{document_id}/url` → `{download_url}`.
  - **`uploaded_by` is absent from that body on purpose.** DataCore's blob API requires it, but a client value is worthless — the enrollx proxy derives it from the authenticated caller (the staff `user_id`) and adds it before calling DataCore. Do not send it from the frontend, and do not "fix" the proxy to accept it (roadmap, DataCore blob API).
  - **Money is integer cents.** The `payment_plan` block's `config` is exactly Plan 3's shape: `{"currency": "usd", "amount_full": <int cents>, "plans": [{"type": "pay_in_full"}, {"type": "deposit", "deposit_amount": <int cents>}]}` — `plans` is an array of objects keyed by `type`, and `deposit_amount` lives ON the deposit plan object. UI inputs/labels are dollars; convert at the edge (`Math.round(dollars * 100)` in, `cents / 100` out).
  - The chosen plan is stored at `draft_data.payment_plan_selection` (Plan 3 contract).
  - Application status values: `draft|submitted|in_review|pending_items|approved|enrolled|waitlisted|declined|withdrawn`. Item status values: `not_started|in_progress|submitted|verified|rejected|waived`.
- **Query SQL convention:** the query proxy takes `{tenant_id, table: 'entities'|'models', sql}` and the SQL always reads `FROM data` — DataCore resolves `data` to the caller's tenant table (this is how every admindash client call works; see `admindash/frontend/src/api/client.ts`). Never put a tenant-prefixed table name in client SQL. If enrollx-backend's `assert_tenant_scoped_sql` guard rejects the bare `data` alias, that guard already broke Plans 2–3's own reads — re-check Task 0 Step 3 before concluding anything.
- **Design system (from `admindash/CLAUDE.md`, applies to enrollx and flow-runtime):** tokens only — no raw hex/rgba outside a theme file; anything that IS text or sits under white text uses `--accent-ink`, while `border-color`/`accent-color`/focus rings use `--accent`; every control has a bound label (`htmlFor`/`id`); radio and checkbox groups use `<fieldset>` + `<legend>`; interactive elements are `<button>`, never `<div onClick>`; never `outline: none` without a visible replacement; every overlay uses the copied `Modal` primitive; every mutation reports via `useToast`; **every new user-facing string goes into i18n for BOTH `en-US` and `zh-CN`** (enrollx: `src/i18n/translations.ts`; flow-runtime: its own `src/i18n.ts`).
- **Import style:** enrollx-frontend uses explicit `.ts`/`.tsx` extensions in relative imports (admindash convention, its tsconfig allows it). flow-runtime uses extensionless relative imports (its Plan 1 tsconfig does not set `allowImportingTsExtensions`).
- **Plan 3 owns enrollx Settings** (`PaymentsSettingsPage`, a Settings nav entry/route). Never remove or rename what Plan 3 added to `App.tsx`/nav — only add.

---

### Task 0: Branch setup and contract verification

Plans 2–3 were executed by other sessions; verify the exact shapes this plan consumes before writing code. No file changes in this task (except the branch).

**Files:** none created.

**Interfaces:**
- Consumes: enrollx backend routes from Plans 1–3; enrollx frontend scaffold from Plan 1.
- Produces: a verified contract table (recorded in the task notes / commit message of Task 5) used by Tasks 5–10.

- [ ] **Step 1: Branch.**

```bash
cd /Users/kennylee/Development/NeoApex && git checkout main && git pull && git checkout -b feat/registration-plan4-builder-staff
```

- [ ] **Step 2: Verify the scaffold exists** (Plan 1 outputs; all must exist):

```bash
ls /Users/kennylee/Development/NeoApex/flow-runtime/src   # expect: FlowRenderer.tsx  index.ts  types.ts
ls /Users/kennylee/Development/NeoApex/enrollx/frontend/src
ls /Users/kennylee/Development/NeoApex/enrollx/frontend/src/pages /Users/kennylee/Development/NeoApex/enrollx/frontend/src/components/ui
grep -n "flow-runtime" /Users/kennylee/Development/NeoApex/enrollx/frontend/package.json   # expect a file: dependency
```

- [ ] **Step 3: Record the backend contract details.** Run each grep and write down the answers — Tasks 5, 7, 8 and 10 reference them as CONTRACT-1..5:

```bash
# CONTRACT-1: the API base-URL export name in the scaffold (likely ENROLLX_API_URL)
grep -n "export const" /Users/kennylee/Development/NeoApex/enrollx/frontend/src/config.ts

# CONTRACT-2: param names each action handler reads (save_draft's draft field name,
# complete_item/verify_item/reject_item/waive_item's item id + payload/reason names,
# record_offline_payment's amount/note names and unit — expect cents)
grep -rn "save_draft\|complete_item\|record_offline_payment\|reject_item\|draft_data" /Users/kennylee/Development/NeoApex/enrollx/backend/app | head -40

# CONTRACT-3: publish_config — which identifier goes in the {application_id} path slot
# (the registration_config entity_id, the config_id, or a body param)
grep -rn "publish_config" /Users/kennylee/Development/NeoApex/enrollx/backend/app

# CONTRACT-4: checkout response field carrying the Stripe URL (expect checkout_url)
grep -rn "checkout" /Users/kennylee/Development/NeoApex/enrollx/backend/app/api | head -20

# CONTRACT-5: whether the SQL guard allowlists the `data` alias
grep -n "assert_tenant_scoped_sql\|_TABLE_REF\|data" /Users/kennylee/Development/NeoApex/enrollx/backend/app/tenancy.py
```

Where a later task says e.g. `draft_data` or `checkout_url`, and CONTRACT-2/4 showed a different spelling, use the spelling the backend actually reads. The **action names and routes themselves are binding and will not differ**.

---

### Task 1: flow-runtime foundations — types, i18n, validation, config accessors, stylesheet

**Files:**
- Modify: `flow-runtime/src/types.ts` (append; keep everything Plan 1 put there)
- Create: `flow-runtime/src/i18n.ts`
- Create: `flow-runtime/src/validateField.ts`
- Create: `flow-runtime/src/blockConfig.ts`
- Create: `flow-runtime/src/money.ts`
- Create: `flow-runtime/src/flow-runtime.css`

**Interfaces:**
- Consumes: Plan 1's `types.ts` (`BlockType`, `FlowBlock`, `RegistrationConfigDef`, `FlowMode`).
- Produces: `ApplicationStatus`, `ItemStatus`, `ItemKind`, `ApplicationSummary`, `ApplicationItem`, `FlowField`, `RequiredDoc`, `PaymentPlanKind`, `DONE_ITEM_STATUSES`; `flowT(key)`; `validateFlowField(field, value)`; `formFields/docsOf/plansOf/planAmounts/messageBody`; `formatCents(cents)`. All consumed by Tasks 2–4 and by Plan 5.
- **Binding for Plan 5 — draft values shape:** `values` / `draft_data` is `{ [block_id]: Record<fieldName, unknown>, payment_plan_selection?: 'pay_in_full' | 'deposit' }`.

- [ ] **Step 1: Append to `flow-runtime/src/types.ts`** (below Plan 1's existing content, do not edit the existing declarations):

```ts
// ---- Runtime data shapes (Plan 4) -----------------------------------------

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'in_review' | 'pending_items' | 'approved'
  | 'enrolled' | 'waitlisted' | 'declined' | 'withdrawn';

export type ItemStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'verified' | 'rejected' | 'waived';

export type ItemKind = 'form' | 'document' | 'esign' | 'payment';

/** The slice of a registration_application entity the renderer needs. */
export interface ApplicationSummary {
  application_id: string;
  program_id: string;
  school_year: string;
  status: ApplicationStatus;
  channel_started: 'parent' | 'admin';
  config_version: number;
  applicant_email?: string;
}

/** One application_item entity row. */
export interface ApplicationItem {
  item_id: string;
  application_id: string;
  block_id: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  blocking: boolean;
  due_at?: string;
  completed_by?: string;
  payload_ref?: string;
}

/** One field inside a form block (same shape as an entity-model field). */
export interface FlowField {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}

/** One required document inside a documents block (spec §4). */
export interface RequiredDoc {
  name: string;
  description?: string;
  sensitive: boolean;
  blocking: boolean;
  due_days_after_approval?: number;
}

export type PaymentPlanKind = 'pay_in_full' | 'deposit';

/** One entry of payment_plan config's plans[] (Plan 3 contract). */
export interface PaymentPlanOption {
  type: PaymentPlanKind;
  /** integer cents; present on deposit plans. */
  deposit_amount?: number;
}

/** Item statuses that count as "done" for gating (spec §5). */
export const DONE_ITEM_STATUSES: readonly ItemStatus[] = ['submitted', 'verified', 'waived'];
```

- [ ] **Step 2: Create `flow-runtime/src/i18n.ts`.** flow-runtime cannot import a host's translations; it ships its own strings and resolves the locale the same way the hosts persist it (`localStorage['preferredLanguage']`, written by `useTranslation`). Hosts re-render on locale change, which re-renders these components, so no listener is needed here.

```ts
// flow-runtime/src/i18n.ts
const STRINGS: Record<'en-US' | 'zh-CN', Record<string, string>> = {
  'en-US': {
    required: 'required',
    errRequired: 'Required',
    errNumber: 'Must be a number',
    errEmail: 'Invalid email',
    errPhone: 'Invalid phone number',
    back: 'Back',
    next: 'Save & continue',
    saving: 'Saving…',
    step: 'Step',
    previewNotice: 'Preview — nothing is saved.',
    noFields: 'No fields configured yet.',
    upload: 'Upload',
    replace: 'Replace',
    uploading: 'Uploading…',
    sensitiveDoc: 'Sensitive — staff only',
    postApproval: 'Due after approval',
    choosePlan: 'Choose a payment plan',
    planPayInFull: 'Pay in full',
    planDeposit: 'Deposit now, balance later',
    amountDue: 'Amount due',
    amountAtCheckout: 'Amount is determined at checkout',
    pay: 'Pay',
    paid: 'Paid',
    recordOfflinePayment: 'Record offline payment',
    submitApplication: 'Submit application',
    submitting: 'Submitting…',
    outstandingBefore: 'Complete these required steps before submitting:',
    'status.not_started': 'Not started',
    'status.in_progress': 'In progress',
    'status.submitted': 'Submitted',
    'status.verified': 'Verified',
    'status.rejected': 'Rejected',
    'status.waived': 'Waived',
  },
  'zh-CN': {
    required: '必填',
    errRequired: '必填',
    errNumber: '必须是数字',
    errEmail: '邮箱格式不正确',
    errPhone: '电话号码格式不正确',
    back: '上一步',
    next: '保存并继续',
    saving: '保存中…',
    step: '步骤',
    previewNotice: '预览模式——不会保存任何内容。',
    noFields: '尚未配置任何字段。',
    upload: '上传',
    replace: '重新上传',
    uploading: '上传中…',
    sensitiveDoc: '敏感文件——仅限工作人员查看',
    postApproval: '录取后提交',
    choosePlan: '选择付款方式',
    planPayInFull: '全额付款',
    planDeposit: '先付定金，后付尾款',
    amountDue: '应付金额',
    amountAtCheckout: '金额以结账页面为准',
    pay: '支付',
    paid: '已支付',
    recordOfflinePayment: '记录线下付款',
    submitApplication: '提交申请',
    submitting: '提交中…',
    outstandingBefore: '提交前请完成以下必要步骤：',
    'status.not_started': '未开始',
    'status.in_progress': '进行中',
    'status.submitted': '已提交',
    'status.verified': '已核验',
    'status.rejected': '已退回',
    'status.waived': '已豁免',
  },
};

export function flowLocale(): 'en-US' | 'zh-CN' {
  try {
    return localStorage.getItem('preferredLanguage') === 'zh-CN' ? 'zh-CN' : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Translate a flow-runtime string. Falls back en-US, then the key itself. */
export function flowT(key: string): string {
  return STRINGS[flowLocale()][key] ?? STRINGS['en-US'][key] ?? key;
}
```

- [ ] **Step 3: Create `flow-runtime/src/validateField.ts`** (port of `admindash/frontend/src/utils/validateField.ts`, messages localized):

```ts
// flow-runtime/src/validateField.ts
import type { FlowField } from './types';
import { flowT } from './i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

export function validateFlowField(field: FlowField, value: unknown): string | null {
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null;
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return flowT('errRequired');
    return null;
  }

  if (field.required && isEmpty) return flowT('errRequired');
  if (isEmpty) return null;

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return flowT('errNumber');
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return flowT('errEmail');
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return flowT('errPhone');
      break;
  }
  return null;
}
```

- [ ] **Step 4: Create `flow-runtime/src/blockConfig.ts`** — typed accessors over `FlowBlock.config` (which is `Record<string, unknown>`), including the Plan 3 cents contract:

```ts
// flow-runtime/src/blockConfig.ts
import type { FlowBlock, FlowField, PaymentPlanOption, RequiredDoc } from './types';

/**
 * Fields of a form block. `config.fields` is the HOST-hydrated list (set when
 * the block draws from an entity model); `config.custom_fields` is the
 * builder-authored list. Hydration wins when present.
 */
export function formFields(block: FlowBlock): FlowField[] {
  const hydrated = block.config.fields;
  if (Array.isArray(hydrated)) return hydrated as FlowField[];
  const custom = block.config.custom_fields;
  return Array.isArray(custom) ? (custom as FlowField[]) : [];
}

export function docsOf(block: FlowBlock): RequiredDoc[] {
  const d = block.config.docs;
  return Array.isArray(d) ? (d as RequiredDoc[]) : [];
}

/** Offered plans of a payment_plan block (array of {type, deposit_amount?}). */
export function plansOf(block: FlowBlock): PaymentPlanOption[] {
  const p = block.config.plans;
  if (!Array.isArray(p)) return [];
  return (p as unknown[]).filter((o): o is PaymentPlanOption => {
    if (typeof o !== 'object' || o === null) return false;
    const t = (o as { type?: unknown }).type;
    return t === 'pay_in_full' || t === 'deposit';
  });
}

/** Amounts in integer cents: amount_full is top-level config, deposit_amount
 *  lives on the deposit plan object (Plan 3 contract). */
export function planAmounts(block: FlowBlock): { amount_full: number; deposit_amount: number } {
  const deposit = plansOf(block).find((p) => p.type === 'deposit');
  return {
    amount_full: typeof block.config.amount_full === 'number' ? block.config.amount_full : 0,
    deposit_amount: typeof deposit?.deposit_amount === 'number' ? deposit.deposit_amount : 0,
  };
}

export function messageBody(block: FlowBlock): string {
  return typeof block.config.body === 'string' ? block.config.body : '';
}
```

- [ ] **Step 5: Create `flow-runtime/src/money.ts`:**

```ts
// flow-runtime/src/money.ts
/** Format integer cents as a currency string ("$1,234.50"). */
export function formatCents(cents: number | undefined | null): string {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}
```

- [ ] **Step 6: Create `flow-runtime/src/flow-runtime.css`.** Tokens only — every value references a `--token` from `@neoapex/ui-tokens` (loaded by the host). Text/filled-button colors use `--accent-ink`; borders and focus use `--accent`.

```css
/* flow-runtime/src/flow-runtime.css — block/renderer styles, ui-tokens only */
.flow-renderer { display: flex; flex-direction: column; gap: 16px; }

.fr-preview-notice {
  background: var(--warning-muted); color: var(--text-primary);
  border: 1px solid var(--warning); border-radius: var(--radius-sm);
  padding: 8px 12px; font-size: 13px;
}

.fr-steps { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.fr-steps li { display: flex; }
.fr-step-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border-primary); background: var(--bg-card);
  color: var(--text-secondary); border-radius: var(--radius-sm);
  padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer;
}
.fr-step-btn[aria-current='step'] { border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.fr-step-btn .fr-step-done { color: var(--success); }

.fr-block { background: var(--bg-card); border: 1px solid var(--border-primary);
  border-radius: var(--radius-md); padding: 20px; }
.fr-block-title { margin: 0 0 12px; font-size: 17px; color: var(--text-primary); }

.fr-form-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.fr-field { display: flex; flex-direction: column; gap: 4px; }
.fr-field label, .fr-legend { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.fr-field--checkbox { flex-direction: row; align-items: center; gap: 8px; }
.fr-input {
  height: 36px; padding: 0 10px; border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary);
  font: inherit; font-size: 14px;
}
.fr-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.fr-fieldset { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px 12px; margin: 0; }
.fr-choice-group { display: flex; flex-direction: column; gap: 6px; }
.fr-choice-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-primary); }
input[type='radio'], input[type='checkbox'] { accent-color: var(--accent); }
.fr-required { color: var(--danger); margin-left: 2px; }
.fr-field-error { color: var(--danger); font-size: 12px; }
.fr-empty { color: var(--text-tertiary); font-size: 14px; }
.fr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.fr-doc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.fr-doc-row { display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); padding: 10px 12px; flex-wrap: wrap; }
.fr-doc-info { flex: 1 1 220px; min-width: 0; }
.fr-doc-info strong { color: var(--text-primary); font-size: 14px; }
.fr-doc-info p { margin: 2px 0 0; color: var(--text-secondary); font-size: 13px; }
.fr-doc-flags { display: flex; gap: 6px; margin-top: 4px; }
.fr-doc-flag { font-size: 11px; padding: 1px 6px; border-radius: 999px;
  background: var(--bg-tertiary); color: var(--text-secondary); }
.fr-hidden-input { display: none; }

.fr-item-status { font-size: 12px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.fr-item-status--not_started, .fr-item-status--in_progress { background: var(--bg-tertiary); color: var(--text-secondary); }
.fr-item-status--submitted { background: var(--info-muted); color: var(--accent-ink); }
.fr-item-status--verified { background: var(--success-muted); color: var(--tint-green-text); }
.fr-item-status--rejected { background: var(--danger-muted); color: var(--danger); }
.fr-item-status--waived { background: var(--tint-amber-bg); color: var(--tint-amber-text); }

.fr-payment-amount { font-size: 22px; font-weight: 700; color: var(--text-primary); margin: 4px 0 12px; }
.fr-payment-paid { display: inline-flex; align-items: center; gap: 8px;
  background: var(--success-muted); color: var(--tint-green-text);
  border-radius: var(--radius-sm); padding: 8px 12px; font-weight: 600; }

.fr-message-body p { margin: 0 0 8px; color: var(--text-primary); line-height: 1.55; }

.fr-review-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fr-review-list li { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-primary); }
.fr-review-done span[aria-hidden] { color: var(--success); }
.fr-review-open span[aria-hidden] { color: var(--text-tertiary); }
.fr-review-warn { background: var(--warning-muted); border-radius: var(--radius-sm);
  padding: 8px 12px; color: var(--text-primary); font-size: 13px; }

.fr-footer { display: flex; justify-content: space-between; gap: 12px; }
.fr-footer-spacer { flex: 1; }

.fr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 16px; border-radius: var(--radius-sm);
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border-primary); background: var(--bg-card); color: var(--text-primary);
}
.fr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.fr-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.fr-btn--primary { background: var(--accent-ink); border-color: var(--accent-ink); color: var(--text-inverse); }
```

- [ ] **Step 7: Typecheck and commit.**

```bash
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
git add flow-runtime
git commit -m "feat(flow-runtime): runtime types, i18n, validation, block-config accessors, stylesheet"
```

---

### Task 2: flow-runtime FormBlock (the DynamicForm port)

Port of `admindash/frontend/src/components/DynamicForm.tsx`, reshaped for the flow runtime: it takes a flat `FlowField[]` (no base/custom split), is fully controlled (FlowRenderer owns values and persistence — no submit/cancel buttons, no internal state), and shows errors only after a failed step-advance. Entity-model-sourced fields are resolved by the HOST and arrive already merged into the field list (see `formFields` in Task 1).

**Files:**
- Create: `flow-runtime/src/blocks/FormBlock.tsx`

**Interfaces:**
- Consumes: `FlowField`, `flowT`, `flow-runtime.css` classes.
- Produces: `FormBlock`, `FormBlockProps` — used by FlowRenderer (Task 4); a11y contract mirrors DynamicForm (bound labels, `fieldset/legend` for selection groups, `aria-invalid`/`aria-describedby`).

- [ ] **Step 1: Create `flow-runtime/src/blocks/FormBlock.tsx`:**

```tsx
// flow-runtime/src/blocks/FormBlock.tsx
import { useId } from 'react';
import type { FlowField } from '../types';
import { flowT } from '../i18n';

export interface FormBlockProps {
  blockId: string;
  fields: FlowField[];
  values: Record<string, unknown>;
  errors: Record<string, string | null>;
  /** True after a failed step-advance: show every error, not only touched ones. */
  showErrors: boolean;
  readOnly: boolean;
  onChange: (name: string, value: unknown) => void;
}

function labelOf(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FormBlock({
  blockId, fields, values, errors, showErrors, readOnly, onChange,
}: FormBlockProps) {
  const baseId = useId();
  const idFor = (name: string) => `${baseId}-${blockId}-${name}`;

  const renderControl = (field: FlowField) => {
    const value = values[field.name] ?? field.default ?? (field.type === 'bool' ? false : '');
    const str = value != null ? String(value) : '';
    const id = idFor(field.name);
    const err = showErrors ? errors[field.name] : null;
    const common = {
      id,
      disabled: readOnly,
      'aria-invalid': err ? true : undefined,
      'aria-describedby': err ? `${id}-error` : undefined,
    } as const;

    switch (field.type) {
      case 'number':
        return (
          <input {...common} type="number" className="fr-input" value={str}
            onChange={(e) => onChange(field.name, e.target.value === '' ? '' : Number(e.target.value))} />
        );
      case 'bool':
        return (
          <input {...common} type="checkbox" checked={value === true || value === 'true'}
            onChange={(e) => onChange(field.name, e.target.checked)} />
        );
      case 'date':
        return <input {...common} type="date" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'datetime':
        return <input {...common} type="datetime-local" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'email':
        return <input {...common} type="email" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'phone':
        return <input {...common} type="tel" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'selection': {
        if (field.multiple) {
          const selected = Array.isArray(value)
            ? (value as string[])
            : typeof value === 'string' && value ? [value] : [];
          return (
            <div className="fr-choice-group">
              {(field.options ?? []).map((opt, i) => (
                <label key={opt} className="fr-choice-label">
                  <input id={i === 0 ? id : undefined} type="checkbox" disabled={readOnly}
                    checked={selected.includes(opt)}
                    onChange={(e) => onChange(
                      field.name,
                      e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt),
                    )} />
                  {opt}
                </label>
              ))}
            </div>
          );
        }
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : '')
          : str;
        return (
          <div className="fr-choice-group">
            {(field.options ?? []).map((opt, i) => (
              <label key={opt} className="fr-choice-label">
                <input id={i === 0 ? id : undefined} type="radio" name={`${id}-group`} value={opt}
                  disabled={readOnly} checked={radioValue === opt}
                  onChange={() => onChange(field.name, opt)} />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      default:
        return <input {...common} type="text" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
    }
  };

  if (fields.length === 0) return <p className="fr-empty">{flowT('noFields')}</p>;

  return (
    <div className="fr-form-fields">
      {fields.map((field) => {
        const id = idFor(field.name);
        const err = showErrors ? errors[field.name] : null;
        const labelText = (
          <>
            {labelOf(field.name)}
            {field.required && (
              <>
                <span className="fr-required" aria-hidden="true">*</span>
                <span className="fr-sr-only"> ({flowT('required')})</span>
              </>
            )}
          </>
        );
        const errorNode = err
          ? <span className="fr-field-error" id={`${id}-error`}>{err}</span>
          : null;

        // A single <label> cannot name a set of controls; selection groups get
        // fieldset/legend (design-system invariant).
        if (field.type === 'selection') {
          return (
            <fieldset key={field.name} className="fr-field fr-fieldset"
              aria-describedby={err ? `${id}-error` : undefined}
              aria-required={field.required || undefined}>
              <legend className="fr-legend">{labelText}</legend>
              {renderControl(field)}
              {errorNode}
            </fieldset>
          );
        }
        return (
          <div key={field.name}
            className={`fr-field${field.type === 'bool' ? ' fr-field--checkbox' : ''}`}>
            <label htmlFor={id}>{labelText}</label>
            {renderControl(field)}
            {errorNode}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit.**

```bash
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
git add flow-runtime/src/blocks/FormBlock.tsx
git commit -m "feat(flow-runtime): FormBlock — controlled DynamicForm port with a11y contract"
```

---

### Task 3: flow-runtime remaining blocks — Documents, PaymentPlan, Payment, Message, Review

**Files:**
- Create: `flow-runtime/src/blocks/DocumentsBlock.tsx`
- Create: `flow-runtime/src/blocks/PaymentPlanBlock.tsx`
- Create: `flow-runtime/src/blocks/PaymentBlock.tsx`
- Create: `flow-runtime/src/blocks/MessageBlock.tsx`
- Create: `flow-runtime/src/blocks/ReviewBlock.tsx`

**Interfaces:**
- Consumes: Task 1 types/accessors/i18n/money; items are matched to a documents block's docs by `item.block_id === block.block_id && item.title === doc.name` (Plan 2 derives item titles from doc names — this equality is the join key).
- Produces: the five components used by FlowRenderer (Task 4). PaymentPlanBlock writes `payment_plan_selection`; PaymentBlock consumes `onCheckout(itemId)` / `onRecordOfflinePayment(itemId)`.

- [ ] **Step 1: Create `flow-runtime/src/blocks/DocumentsBlock.tsx`:**

```tsx
// flow-runtime/src/blocks/DocumentsBlock.tsx
import { useRef, useState } from 'react';
import type { ApplicationItem, FlowBlock, FlowMode, RequiredDoc } from '../types';
import { docsOf } from '../blockConfig';
import { flowT } from '../i18n';

export interface DocumentsBlockProps {
  block: FlowBlock;
  items: ApplicationItem[];
  mode: FlowMode;
  onUpload: (blockId: string, doc: RequiredDoc, file: File) => Promise<void>;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';

export function DocumentsBlock({ block, items, mode, onUpload }: DocumentsBlockProps) {
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const docs = docsOf(block);

  const itemFor = (doc: RequiredDoc) =>
    items.find((i) => i.title === doc.name) ?? null;

  const handleFile = async (doc: RequiredDoc, file: File | undefined) => {
    if (!file || mode === 'preview') return;
    setUploadingDoc(doc.name);
    try {
      await onUpload(block.block_id, doc, file);
    } finally {
      setUploadingDoc(null);
    }
  };

  if (docs.length === 0) return <p className="fr-empty">{flowT('noFields')}</p>;

  return (
    <ul className="fr-doc-list">
      {docs.map((doc) => {
        const item = itemFor(doc);
        const status = item?.status ?? 'not_started';
        const done = status === 'submitted' || status === 'verified' || status === 'waived';
        return (
          <li key={doc.name} className="fr-doc-row">
            <div className="fr-doc-info">
              <strong>{doc.name}</strong>
              {doc.description && <p>{doc.description}</p>}
              <div className="fr-doc-flags">
                {doc.sensitive && <span className="fr-doc-flag">{flowT('sensitiveDoc')}</span>}
                {!doc.blocking && <span className="fr-doc-flag">{flowT('postApproval')}</span>}
              </div>
            </div>
            <span className={`fr-item-status fr-item-status--${status}`}>
              {flowT(`status.${status}`)}
            </span>
            <input
              ref={(el) => { inputRefs.current[doc.name] = el; }}
              className="fr-hidden-input"
              type="file"
              accept={ACCEPT}
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void handleFile(doc, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="fr-btn"
              disabled={uploadingDoc !== null || mode === 'preview'}
              aria-label={`${done ? flowT('replace') : flowT('upload')} — ${doc.name}`}
              onClick={() => inputRefs.current[doc.name]?.click()}
            >
              {uploadingDoc === doc.name
                ? flowT('uploading')
                : done ? flowT('replace') : flowT('upload')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Create `flow-runtime/src/blocks/PaymentPlanBlock.tsx`** (radio group in fieldset/legend; amounts shown from the cents fields):

```tsx
// flow-runtime/src/blocks/PaymentPlanBlock.tsx
import type { FlowBlock, PaymentPlanKind } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
import { formatCents } from '../money';
import { flowT } from '../i18n';

export interface PaymentPlanBlockProps {
  block: FlowBlock;
  /** Current draft_data.payment_plan_selection ('' when unset). */
  value: string;
  disabled: boolean;
  onChange: (kind: PaymentPlanKind) => void;
}

export function PaymentPlanBlock({ block, value, disabled, onChange }: PaymentPlanBlockProps) {
  const plans = plansOf(block);
  const amounts = planAmounts(block);
  const groupName = `fr-plan-${block.block_id}`;

  const labelFor = (kind: PaymentPlanKind) =>
    kind === 'pay_in_full'
      ? `${flowT('planPayInFull')} — ${formatCents(amounts.amount_full)}`
      : `${flowT('planDeposit')} — ${formatCents(amounts.deposit_amount)}`;

  if (plans.length === 0) return <p className="fr-empty">{flowT('noFields')}</p>;

  return (
    <fieldset className="fr-fieldset">
      <legend className="fr-legend">{flowT('choosePlan')}</legend>
      <div className="fr-choice-group">
        {plans.map((plan) => (
          <label key={plan.type} className="fr-choice-label">
            <input type="radio" name={groupName} value={plan.type} disabled={disabled}
              checked={value === plan.type} onChange={() => onChange(plan.type)} />
            {labelFor(plan.type)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: Create `flow-runtime/src/blocks/PaymentBlock.tsx`.** The due amount derives from the config's payment_plan block plus the chosen plan; the item's status carries paid-ness (Plan 2/3 mark the payment item done on webhook/offline recording). Staff mode additionally offers offline recording when the host injects the callback:

```tsx
// flow-runtime/src/blocks/PaymentBlock.tsx
import type { ApplicationItem, FlowMode, RegistrationConfigDef } from '../types';
import { planAmounts, plansOf } from '../blockConfig';
import { formatCents } from '../money';
import { flowT } from '../i18n';
import { DONE_ITEM_STATUSES } from '../types';

export interface PaymentBlockProps {
  config: RegistrationConfigDef;
  /** draft_data.payment_plan_selection ('' when unset). */
  planChoice: string;
  item: ApplicationItem | null;
  mode: FlowMode;
  onCheckout: (itemId: string) => Promise<void>;
  onRecordOfflinePayment?: (itemId: string) => void;
}

export function PaymentBlock({
  config, planChoice, item, mode, onCheckout, onRecordOfflinePayment,
}: PaymentBlockProps) {
  const planBlock = config.blocks.find((b) => b.type === 'payment_plan') ?? null;
  const plans = planBlock ? plansOf(planBlock) : [];
  const amounts = planBlock ? planAmounts(planBlock) : null;
  const kinds = plans.map((p) => p.type);
  const chosen = kinds.includes(planChoice as 'pay_in_full' | 'deposit')
    ? (planChoice as 'pay_in_full' | 'deposit')
    : kinds.length === 1 ? kinds[0] : null;
  const cents = amounts && chosen
    ? (chosen === 'deposit' ? amounts.deposit_amount : amounts.amount_full)
    : null;

  const paid = item != null && (DONE_ITEM_STATUSES as readonly string[]).includes(item.status);

  return (
    <div>
      <p className="fr-legend">{flowT('amountDue')}</p>
      <p className="fr-payment-amount">
        {cents != null ? formatCents(cents) : flowT('amountAtCheckout')}
      </p>

      {paid ? (
        <p className="fr-payment-paid">
          <span aria-hidden="true">✓</span> {flowT('paid')}
        </p>
      ) : (
        <div className="fr-footer">
          <button type="button" className="fr-btn fr-btn--primary"
            disabled={mode === 'preview' || item == null}
            onClick={() => { if (item) void onCheckout(item.item_id); }}>
            {flowT('pay')}
          </button>
          {mode === 'staff' && onRecordOfflinePayment && (
            <button type="button" className="fr-btn"
              disabled={item == null}
              onClick={() => { if (item) onRecordOfflinePayment(item.item_id); }}>
              {flowT('recordOfflinePayment')}
            </button>
          )}
          <span className="fr-footer-spacer" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `flow-runtime/src/blocks/MessageBlock.tsx`** (v1 renders the body as plain-text paragraphs split on newlines — rich text is a Phase 2 concern; never inject HTML):

```tsx
// flow-runtime/src/blocks/MessageBlock.tsx
import type { FlowBlock } from '../types';
import { messageBody } from '../blockConfig';

export function MessageBlock({ block }: { block: FlowBlock }) {
  const paragraphs = messageBody(block).split('\n').filter((p) => p.trim() !== '');
  return (
    <div className="fr-message-body">
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}
```

- [ ] **Step 5: Create `flow-runtime/src/blocks/ReviewBlock.tsx`:**

```tsx
// flow-runtime/src/blocks/ReviewBlock.tsx
import type { ApplicationItem, FlowMode, RegistrationConfigDef } from '../types';
import { DONE_ITEM_STATUSES } from '../types';
import { flowT } from '../i18n';

export interface ReviewBlockProps {
  config: RegistrationConfigDef;
  items: ApplicationItem[];
  /** draft_data.payment_plan_selection ('' when unset). */
  planChoice: string;
  canSubmit: boolean;
  outstanding: ApplicationItem[];
  busy: boolean;
  mode: FlowMode;
  onSubmit: () => Promise<void>;
}

export function ReviewBlock({
  config, items, planChoice, canSubmit, outstanding, busy, mode, onSubmit,
}: ReviewBlockProps) {
  const isDone = (i: ApplicationItem) =>
    (DONE_ITEM_STATUSES as readonly string[]).includes(i.status);

  const blockDone = (blockId: string, type: string): boolean => {
    if (type === 'payment_plan') return planChoice !== '';
    const its = items.filter((i) => i.block_id === blockId);
    if (its.length === 0) return false;
    return its.filter((i) => i.blocking).every(isDone) &&
      (its.some((i) => i.blocking) ? true : its.some(isDone));
  };

  return (
    <div className="fr-review">
      <ul className="fr-review-list">
        {config.blocks
          .filter((b) => b.type !== 'review' && b.type !== 'message')
          .map((b) => {
            const done = blockDone(b.block_id, b.type);
            return (
              <li key={b.block_id} className={done ? 'fr-review-done' : 'fr-review-open'}>
                <span aria-hidden="true">{done ? '✓' : '○'}</span> {b.title}
              </li>
            );
          })}
      </ul>

      {outstanding.length > 0 && (
        <p className="fr-review-warn" role="status">
          {flowT('outstandingBefore')} {outstanding.map((i) => i.title).join(', ')}
        </p>
      )}

      <button type="button" className="fr-btn fr-btn--primary"
        disabled={!canSubmit || busy || mode === 'preview'}
        onClick={() => void onSubmit()}>
        {busy ? flowT('submitting') : flowT('submitApplication')}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and commit.**

```bash
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
git add flow-runtime/src/blocks
git commit -m "feat(flow-runtime): documents, payment-plan, payment, message and review blocks"
```

---

### Task 4: FlowRenderer — the real block-walking renderer

Replaces Plan 1's placeholder body while keeping the `FlowRenderer` / `FlowRendererProps` export names. Ordered walk with a step rail; a form block validates before advancing; blocking items gate ONLY submission (spec §5 — non-blocking/post-approval items never gate, and documents steps can be skipped and returned to). Field edits autosave (1.5 s debounce) — server-side drafts are what let staff and parents hand off mid-application (spec §6).

**Files:**
- Modify: `flow-runtime/src/FlowRenderer.tsx` (full replacement)
- Modify: `flow-runtime/src/index.ts` (full replacement)

**Interfaces:**
- Consumes: Tasks 1–3 exports.
- Produces — **THE Plan 4/Plan 5 contract.** `FlowRendererProps` exactly as below; familyhub (Plan 5) passes the same `onSaveDraft, onCompleteItem, onUploadDocument, onCheckout, onSubmit` names; `onRecordOfflinePayment` is the optional staff-only extra that familyhub never passes. `values` follows the Task 1 draft-data shape (`{[block_id]: {...fields}, payment_plan_selection?}`).

- [ ] **Step 1: Replace `flow-runtime/src/FlowRenderer.tsx` entirely with:**

```tsx
// flow-runtime/src/FlowRenderer.tsx
import { useEffect, useRef, useState } from 'react';
import type {
  ApplicationItem, ApplicationSummary, FlowBlock, FlowMode,
  PaymentPlanKind, RegistrationConfigDef, RequiredDoc,
} from './types';
import { DONE_ITEM_STATUSES } from './types';
import { formFields } from './blockConfig';
import { validateFlowField } from './validateField';
import { flowT } from './i18n';
import { FormBlock } from './blocks/FormBlock';
import { DocumentsBlock } from './blocks/DocumentsBlock';
import { PaymentPlanBlock } from './blocks/PaymentPlanBlock';
import { PaymentBlock } from './blocks/PaymentBlock';
import { MessageBlock } from './blocks/MessageBlock';
import { ReviewBlock } from './blocks/ReviewBlock';
import './flow-runtime.css';

export interface FlowRendererProps {
  config: RegistrationConfigDef;
  mode: FlowMode;
  /** null in preview mode (builder). */
  application: ApplicationSummary | null;
  /** [] in preview mode. */
  items: ApplicationItem[];
  /**
   * Parsed draft_data: { [block_id]: Record<fieldName, unknown>,
   * payment_plan_selection?: 'pay_in_full' | 'deposit' }.
   */
  values: Record<string, unknown>;
  /** Persist draft values (action save_draft). Debounced autosave + step advance. */
  onSaveDraft: (values: Record<string, unknown>) => Promise<void>;
  /** Mark one item complete (action complete_item) with an optional payload. */
  onCompleteItem: (itemId: string, payload?: Record<string, unknown>) => Promise<void>;
  /** Upload one file for one named doc; host presigns, PUTs, completes the item. */
  onUploadDocument: (blockId: string, doc: RequiredDoc, file: File) => Promise<void>;
  /** Start Stripe Checkout for the payment item. */
  onCheckout: (itemId: string) => Promise<void>;
  /** Submit the application (action submit; review block only). */
  onSubmit: () => Promise<void>;
  /** Staff mode only: open the host's offline-payment recorder for the item. */
  onRecordOfflinePayment?: (itemId: string) => void;
}

const AUTOSAVE_MS = 1500;

export function FlowRenderer({
  config, mode, application, items, values,
  onSaveDraft, onCompleteItem, onUploadDocument, onCheckout, onSubmit,
  onRecordOfflinePayment,
}: FlowRendererProps) {
  const blocks = config.blocks;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<number | undefined>(undefined);

  // Re-seed local draft when the host loads a different application.
  const appId = application?.application_id ?? null;
  useEffect(() => {
    setDraft(values);
    setStep(0);
    setShowErrors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const scheduleAutosave = (next: Record<string, unknown>) => {
    if (mode === 'preview') return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void onSaveDraft(next); }, AUTOSAVE_MS);
  };

  const itemsFor = (block: FlowBlock) => items.filter((i) => i.block_id === block.block_id);
  const isDone = (i: ApplicationItem) =>
    (DONE_ITEM_STATUSES as readonly string[]).includes(i.status);

  const planChoice =
    typeof draft.payment_plan_selection === 'string' ? draft.payment_plan_selection : '';

  const blockValues = (block: FlowBlock): Record<string, unknown> =>
    (draft[block.block_id] as Record<string, unknown> | undefined) ?? {};

  const setFieldValue = (block: FlowBlock, name: string, value: unknown) => {
    setDraft((prev) => {
      const next = {
        ...prev,
        [block.block_id]: {
          ...((prev[block.block_id] as Record<string, unknown> | undefined) ?? {}),
          [name]: value,
        },
      };
      scheduleAutosave(next);
      return next;
    });
  };

  const setPlanChoice = (kind: PaymentPlanKind) => {
    setDraft((prev) => {
      const next = { ...prev, payment_plan_selection: kind };
      scheduleAutosave(next);
      return next;
    });
  };

  const formErrors = (block: FlowBlock): Record<string, string | null> => {
    const vals = blockValues(block);
    const out: Record<string, string | null> = {};
    for (const f of formFields(block)) out[f.name] = validateFlowField(f, vals[f.name]);
    return out;
  };

  /** Step-rail completeness (indicator only; gating is item-based below). */
  const blockComplete = (block: FlowBlock): boolean => {
    switch (block.type) {
      case 'message': return true;
      case 'review': return false;
      case 'payment_plan': return planChoice !== '';
      default: {
        const its = itemsFor(block);
        if (its.length === 0) return false;
        const blocking = its.filter((i) => i.blocking);
        return (blocking.length > 0 ? blocking : its).every(isDone);
      }
    }
  };

  // Spec §5: only BLOCKING items gate submission; submit is legal from
  // draft (first submission) and pending_items (after fixing a rejection).
  const blockingOutstanding = items.filter((i) => i.blocking && !isDone(i));
  const canSubmit =
    mode !== 'preview' &&
    application != null &&
    (application.status === 'draft' || application.status === 'pending_items') &&
    blockingOutstanding.length === 0;

  const advance = async () => {
    const block = blocks[step];
    if (block.type === 'form') {
      const errs = formErrors(block);
      if (Object.values(errs).some(Boolean)) { setShowErrors(true); return; }
    }
    setShowErrors(false);
    if (mode !== 'preview') {
      setBusy(true);
      try {
        window.clearTimeout(saveTimer.current);
        await onSaveDraft(draftRef.current);
        if (block.type === 'form') {
          const item = itemsFor(block)[0];
          if (item && !isDone(item)) await onCompleteItem(item.item_id, blockValues(block));
        }
      } finally {
        setBusy(false);
      }
    }
    setStep((s) => Math.min(s + 1, blocks.length - 1));
  };

  const submit = async () => {
    if (mode === 'preview') return;
    setBusy(true);
    try {
      window.clearTimeout(saveTimer.current);
      await onSaveDraft(draftRef.current);
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  const renderBlock = (block: FlowBlock) => {
    switch (block.type) {
      case 'form':
        return (
          <FormBlock blockId={block.block_id} fields={formFields(block)}
            values={blockValues(block)} errors={formErrors(block)}
            showErrors={showErrors} readOnly={busy}
            onChange={(name, value) => setFieldValue(block, name, value)} />
        );
      case 'documents':
        return (
          <DocumentsBlock block={block} items={itemsFor(block)} mode={mode}
            onUpload={onUploadDocument} />
        );
      case 'payment_plan':
        return (
          <PaymentPlanBlock block={block} value={planChoice} disabled={busy}
            onChange={setPlanChoice} />
        );
      case 'payment':
        return (
          <PaymentBlock config={config} planChoice={planChoice}
            item={itemsFor(block)[0] ?? null} mode={mode}
            onCheckout={onCheckout} onRecordOfflinePayment={onRecordOfflinePayment} />
        );
      case 'message':
        return <MessageBlock block={block} />;
      case 'review':
        return (
          <ReviewBlock config={config} items={items} planChoice={planChoice}
            canSubmit={canSubmit} outstanding={blockingOutstanding}
            busy={busy} mode={mode} onSubmit={submit} />
        );
      default:
        return null;
    }
  };

  if (blocks.length === 0) return <p className="fr-empty">{flowT('noFields')}</p>;
  const current = blocks[Math.min(step, blocks.length - 1)];

  return (
    <div className="flow-renderer" data-flow-mode={mode}>
      {mode === 'preview' && (
        <p className="fr-preview-notice" role="status">{flowT('previewNotice')}</p>
      )}

      <ol className="fr-steps">
        {blocks.map((b, i) => (
          <li key={b.block_id}>
            <button type="button" className="fr-step-btn"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => { setShowErrors(false); setStep(i); }}>
              {blockComplete(b)
                ? <span className="fr-step-done" aria-hidden="true">✓</span>
                : <span aria-hidden="true">{i + 1}</span>}
              <span className="fr-sr-only">{flowT('step')} {i + 1}: </span>
              {b.title}
            </button>
          </li>
        ))}
      </ol>

      <section className="fr-block" aria-label={current.title}>
        <h3 className="fr-block-title">{current.title}</h3>
        {renderBlock(current)}
      </section>

      <div className="fr-footer">
        {step > 0 ? (
          <button type="button" className="fr-btn" disabled={busy}
            onClick={() => { setShowErrors(false); setStep((s) => s - 1); }}>
            {flowT('back')}
          </button>
        ) : <span />}
        <span className="fr-footer-spacer" />
        {step < blocks.length - 1 && (
          <button type="button" className="fr-btn fr-btn--primary" disabled={busy}
            onClick={() => void advance()}>
            {busy ? flowT('saving') : flowT('next')}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `flow-runtime/src/index.ts` entirely with:**

```ts
// flow-runtime/src/index.ts
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
export { formFields, docsOf, plansOf, planAmounts, messageBody } from './blockConfig';
export { validateFlowField } from './validateField';
export { formatCents } from './money';
export { flowT, flowLocale } from './i18n';
export { FormBlock, type FormBlockProps } from './blocks/FormBlock';
export { DocumentsBlock, type DocumentsBlockProps } from './blocks/DocumentsBlock';
export { PaymentPlanBlock, type PaymentPlanBlockProps } from './blocks/PaymentPlanBlock';
export { PaymentBlock, type PaymentBlockProps } from './blocks/PaymentBlock';
export { MessageBlock } from './blocks/MessageBlock';
export { ReviewBlock, type ReviewBlockProps } from './blocks/ReviewBlock';
```

- [ ] **Step 3: Typecheck flow-runtime AND rebuild both consumers** (the placeholder's `{ config, mode }`-only props are gone; Plan 1's smoke imports are type-only and must still pass):

```bash
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build
```

If either host used `<FlowRenderer config={...} mode={...} />` beyond a type import (Plan 3 may have), update that call site to pass the new required props with no-op async callbacks:

```tsx
const noopSave = async (_v: Record<string, unknown>) => {};
const noopItem = async (_id: string, _p?: Record<string, unknown>) => {};
const noopUpload = async (_b: string, _d: RequiredDoc, _f: File) => {};
const noopCheckout = async (_id: string) => {};
const noopSubmit = async () => {};
// <FlowRenderer config={cfg} mode="preview" application={null} items={[]} values={{}}
//   onSaveDraft={noopSave} onCompleteItem={noopItem} onUploadDocument={noopUpload}
//   onCheckout={noopCheckout} onSubmit={noopSubmit} />
```

- [ ] **Step 4: Commit.**

```bash
git add flow-runtime enrollx/frontend familyhub/frontend
git commit -m "feat(flow-runtime): real FlowRenderer — ordered walk, autosave, item-based submit gating"
```

---

### Task 5: enrollx-frontend shared plumbing — copies, API client, routes, nav, base i18n

**Files:**
- Copy from admindash (commands below): `components/DataTable.tsx` + `DataTable.css`, `components/StatusBadge.tsx` + `StatusBadge.css`, `utils/tone.ts`, `utils/listValue.ts`, `contexts/toastStore.ts`, `components/ui/Toast.tsx` + `Toast.css`, `hooks/useToast.ts`, `contexts/ModelContext.tsx`
- Create: `enrollx/frontend/src/api/client.ts`, `enrollx/frontend/src/api/registration.ts`, `enrollx/frontend/src/types/models.ts`, `enrollx/frontend/src/types/registration.ts`, `enrollx/frontend/src/components/AppNav.tsx`, `enrollx/frontend/src/components/AppNav.css`, `enrollx/frontend/src/utils/format.ts`
- Modify: `enrollx/frontend/src/App.tsx` (add providers/routes — keep everything Plans 1/3 put there), `enrollx/frontend/src/i18n/translations.ts` (add keys)

**Interfaces:**
- Consumes: CONTRACT-1 (API base export in `src/config.ts` — code below assumes `ENROLLX_API_URL`; rename the import if CONTRACT-1 differs), enrollx-backend generic proxies + registration routes.
- Produces: `postQuery`, `createEntity`, `updateEntity`, `fetchNextEntityId`, `escapeSql` (api/client.ts); `createApplication`, `postApplicationAction`, `startCheckout`, `uploadDocumentForItem`, `getDocumentUrl`, `publishConfig` (api/registration.ts); `ApplicationRow`, `ItemRow`, `ActivityRow`, `PaymentRow`, `DocumentRow`, `ConfigRow`, `ProgramRow` (types/registration.ts); routes `/programs`, `/programs/:programId/flow`, `/applications`, `/applications/new`, `/applications/:applicationId`, `/applications/:applicationId/enter` — consumed by Tasks 6–10.

- [ ] **Step 1: Copy the shared components** (then fix imports so each file's relative paths resolve inside enrollx):

```bash
cd /Users/kennylee/Development/NeoApex
SRC=admindash/frontend/src; DST=enrollx/frontend/src
mkdir -p $DST/components/ui $DST/utils $DST/contexts $DST/hooks $DST/types $DST/api
cp $SRC/components/DataTable.tsx $SRC/components/DataTable.css $DST/components/
cp $SRC/components/StatusBadge.tsx $SRC/components/StatusBadge.css $DST/components/
cp $SRC/utils/tone.ts $SRC/utils/listValue.ts $DST/utils/
cp $SRC/contexts/toastStore.ts $SRC/contexts/ModelContext.tsx $DST/contexts/
cp $SRC/components/ui/Toast.tsx $SRC/components/ui/Toast.css $DST/components/ui/
cp $SRC/hooks/useToast.ts $DST/hooks/
```

Then make exactly these edits to the copies:
1. `components/StatusBadge.tsx` — add an optional display label (tone still derives from the raw status; pages pass the localized text):

```tsx
// enrollx/frontend/src/components/StatusBadge.tsx (full file after edit)
import { toLabel } from '../utils/listValue.ts';
import { toneFor } from '../utils/tone.ts';
import './StatusBadge.css';

/** Status pill. Tone from the raw status value; text overridable for i18n. */
export default function StatusBadge({ status, label }: { status?: unknown; label?: string }) {
  const text = label ?? toLabel(status, '');
  if (!text || text === '-') return <span>—</span>;

  return <span className={`status-badge status-badge--${toneFor(status)}`}>{text}</span>;
}
```

2. `utils/tone.ts` — in `TONE_BY_STATUS`, add the registration statuses that are missing (keep every existing entry):

```ts
  submitted: 'info',
  in_review: 'info',
  pending_items: 'attn',
  declined: 'risk',
```

3. `contexts/ModelContext.tsx` — it imports `postQuery` from `../api/client.ts` and `ModelDefinition` from `../types/models.ts`; both are created in Steps 2–3, keep the imports as-is.
4. `components/ui/Toast.tsx` and `components/DataTable.tsx` import `useTranslation` — the scaffold already has `src/hooks/useTranslation.ts`; keep imports as-is. Any i18n keys they reference are added in Step 7.

- [ ] **Step 2: Create `enrollx/frontend/src/types/models.ts`:**

```ts
// enrollx/frontend/src/types/models.ts
export interface ModelFieldDefinition {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}

export interface ModelDefinition {
  base_fields: ModelFieldDefinition[];
  custom_fields: ModelFieldDefinition[];
}

export interface CreateEntityResponse {
  entity_type: string;
  entity_id: string;
  base_data: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  _version: number;
  _status: string;
}

export interface NextIdResponse {
  next_id: string;
  tenant_abbrev: string;
  entity_abbrev: string;
  sequence: number;
}
```

- [ ] **Step 3: Create `enrollx/frontend/src/api/client.ts`** (generic proxies; adjust the config import name per CONTRACT-1):

```ts
// enrollx/frontend/src/api/client.ts
import type { CreateEntityResponse, NextIdResponse } from '../types/models.ts';
import { ENROLLX_API_URL } from '../config.ts';

const API_BASE = ENROLLX_API_URL;
const TOKEN_KEY = 'neoapex_token';

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

/** Double single quotes so a value is safe inside a SQL string literal. */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function postQuery(
  tenantId: string,
  table: 'entities' | 'models',
  sql: string,
): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const resp = await fetch(`${API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  return jsonOrThrow(resp);
}

export async function createEntity(
  tenantId: string,
  entityType: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): Promise<CreateEntityResponse> {
  const resp = await fetch(`${API_BASE}/api/entities/${tenantId}/${entityType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
  });
  return jsonOrThrow(resp);
}

export async function updateEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
  });
  return jsonOrThrow(resp);
}

export async function fetchNextEntityId(
  tenantId: string,
  entityType: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/next-id`,
    { headers: authHeaders() },
  );
  return jsonOrThrow(resp);
}
```

- [ ] **Step 4: Create `enrollx/frontend/src/types/registration.ts`** (query-row shapes — entity rows come back flattened, base_data fields at top level plus `entity_id`):

```ts
// enrollx/frontend/src/types/registration.ts
import type { ApplicationStatus, ItemKind, ItemStatus } from '@neoapex/flow-runtime';

export interface ApplicationRow {
  entity_id: string;
  application_id: string;
  program_id: string;
  school_year: string;
  status: ApplicationStatus;
  channel_started: 'parent' | 'admin';
  config_version: number;
  applicant_email?: string;
  draft_data?: string;
  submitted_at?: string;
  decided_at?: string;
  [key: string]: unknown;
}

export interface ItemRow {
  entity_id: string;
  item_id: string;
  application_id: string;
  block_id: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  blocking: boolean | string;
  due_at?: string;
  completed_by?: string;
  payload_ref?: string;
  [key: string]: unknown;
}

export interface ActivityRow {
  entity_id: string;
  activity_id: string;
  application_id: string;
  type: 'status_change' | 'item_change' | 'note' | 'email_sent';
  from_value?: string;
  to_value?: string;
  actor: string;
  at: string;
  [key: string]: unknown;
}

export interface PaymentRow {
  entity_id: string;
  payment_id: string;
  application_id: string;
  kind: 'deposit' | 'balance' | 'full' | 'offline';
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  provider: 'stripe' | 'offline';
  provider_ref?: string;
  recorded_by?: string;
  paid_at?: string;
  [key: string]: unknown;
}

export interface DocumentRow {
  entity_id: string;
  document_id: string;
  application_id: string;
  item_id?: string;
  filename: string;
  content_type: string;
  size: number;
  sensitive: boolean | string;
  uploaded_by: string;
  uploaded_at: string;
  [key: string]: unknown;
}

export interface ConfigRow {
  entity_id: string;
  config_id: string;
  program_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: string; // JSON-serialized FlowBlock[]
  [key: string]: unknown;
}

export interface ProgramRow {
  entity_id: string;
  program_id: string;
  name: string;
  description?: string;
  capacity?: number;
  status?: unknown;
  [key: string]: unknown;
}
```

- [ ] **Step 5: Create `enrollx/frontend/src/api/registration.ts`** (bespoke routes; param spellings per CONTRACT-2/3/4):

```ts
// enrollx/frontend/src/api/registration.ts
import type { RequiredDoc } from '@neoapex/flow-runtime';
import { ENROLLX_API_URL } from '../config.ts';
import { authHeaders, jsonOrThrow } from './client.ts';
import type { ApplicationRow } from '../types/registration.ts';

const API_BASE = ENROLLX_API_URL;

export async function createApplication(
  tenantId: string,
  body: { program_id: string; school_year: string; channel: 'admin'; applicant_email?: string },
): Promise<ApplicationRow> {
  const resp = await fetch(`${API_BASE}/api/registration/${tenantId}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(resp);
}

/** The single typed-action endpoint (Plan 2). 409 = transition not allowed. */
export async function postApplicationAction(
  tenantId: string,
  applicationId: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${tenantId}/applications/${applicationId}/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, ...params }),
    },
  );
  return jsonOrThrow(resp);
}

/**
 * publish_config rides the action endpoint (roadmap contract). CONTRACT-3
 * decides which identifier goes in the path slot — default: the config's
 * config_id. Passing it in the body too is harmless either way.
 */
export async function publishConfig(
  tenantId: string,
  configId: string,
): Promise<Record<string, unknown>> {
  return postApplicationAction(tenantId, configId, 'publish_config', { config_id: configId });
}

/** Plan 3 checkout — response field per CONTRACT-4 (expected: checkout_url). */
export async function startCheckout(
  tenantId: string,
  applicationId: string,
  itemId: string,
): Promise<{ checkout_url: string }> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${tenantId}/applications/${applicationId}/checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ item_id: itemId }),
    },
  );
  return jsonOrThrow(resp);
}

export async function getDocumentUrl(
  tenantId: string,
  documentId: string,
): Promise<{ download_url: string }> {
  const resp = await fetch(
    `${API_BASE}/api/documents/${tenantId}/${documentId}/url`,
    { headers: authHeaders() },
  );
  return jsonOrThrow(resp);
}

/**
 * Full upload path for one required doc: presign via the document proxy, PUT
 * the bytes to R2, then complete the item so status derivation runs (Plan 2).
 *
 * No `uploaded_by` in the body: the enrollx proxy derives it from the caller's
 * JWT (the staff `user_id`) and must not accept it from here (roadmap,
 * DataCore blob API).
 */
export async function uploadDocumentForItem(
  tenantId: string,
  applicationId: string,
  itemId: string,
  doc: RequiredDoc,
  file: File,
): Promise<string> {
  const presignResp = await fetch(`${API_BASE}/api/documents/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      application_id: applicationId,
      item_id: itemId,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      sensitive: doc.sensitive,
    }),
  });
  const presign = await jsonOrThrow<{ document_id: string; upload_url: string }>(presignResp);

  const putResp = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putResp.ok) throw new Error(`Upload failed: HTTP ${putResp.status}`);

  await postApplicationAction(tenantId, applicationId, 'complete_item', {
    item_id: itemId,
    payload: { document_id: presign.document_id },
  });
  return presign.document_id;
}
```

- [ ] **Step 6: Nav + routes.** Create `enrollx/frontend/src/components/AppNav.tsx` and `AppNav.css`:

```tsx
// enrollx/frontend/src/components/AppNav.tsx
import { NavLink } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import './AppNav.css';

export default function AppNav() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <nav className="app-nav" aria-label={t('nav.primary')}>
      <span className="app-nav-brand">EnrollX</span>
      <NavLink to="/programs" className="app-nav-link">{t('nav.programs')}</NavLink>
      <NavLink to="/applications" className="app-nav-link">{t('nav.applications')}</NavLink>
      {/* Plan 3's Settings entry: if App.tsx has a settings route, link it here
          with t('nav.settings') — add the link, never remove Plan 3's route. */}
      <span className="app-nav-spacer" />
      {user && <span className="app-nav-user">{user.name}</span>}
      <button type="button" className="app-nav-logout" onClick={logout}>
        {t('nav.logout')}
      </button>
    </nav>
  );
}
```

```css
/* enrollx/frontend/src/components/AppNav.css */
.app-nav { display: flex; align-items: center; gap: 16px; padding: 0 20px;
  height: 56px; background: var(--bg-card); border-bottom: 1px solid var(--border-primary); }
.app-nav-brand { font-weight: 700; color: var(--text-primary); }
.app-nav-link { color: var(--text-secondary); text-decoration: none; font-size: 14px;
  padding: 6px 10px; border-radius: var(--radius-sm); }
.app-nav-link:hover { background: var(--bg-tertiary); }
.app-nav-link.active { color: var(--accent-ink); font-weight: 600; }
.app-nav-spacer { flex: 1; }
.app-nav-user { color: var(--text-tertiary); font-size: 13px; }
.app-nav-logout { border: 1px solid var(--border-primary); background: var(--bg-card);
  color: var(--text-primary); border-radius: var(--radius-sm); padding: 6px 12px;
  font: inherit; font-size: 13px; cursor: pointer; }
.app-nav-logout:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
```

Then edit `enrollx/frontend/src/App.tsx` — ADD, never remove (Plan 1's login guard and HomePage, and any Plan 3 settings route stay). Inside the authenticated branch:
1. Wrap the routed tree with `<ToastProvider>` (from `./components/ui/Toast.tsx`) and `<ModelProvider>` (from `./contexts/ModelContext.tsx`) if not already wrapped.
2. Render `<AppNav />` above the `<Routes>`.
3. Add imports and routes:

```tsx
import ProgramsPage from './pages/ProgramsPage.tsx';
import ConfigBuilderPage from './pages/ConfigBuilderPage.tsx';
import ApplicationsPage from './pages/ApplicationsPage.tsx';
import NewApplicationPage from './pages/NewApplicationPage.tsx';
import ApplicationDetailPage from './pages/ApplicationDetailPage.tsx';
import ApplicationEntryPage from './pages/ApplicationEntryPage.tsx';
```

```tsx
<Route path="/programs" element={<ProgramsPage />} />
<Route path="/programs/:programId/flow" element={<ConfigBuilderPage />} />
<Route path="/applications" element={<ApplicationsPage />} />
<Route path="/applications/new" element={<NewApplicationPage />} />
<Route path="/applications/:applicationId" element={<ApplicationDetailPage />} />
<Route path="/applications/:applicationId/enter" element={<ApplicationEntryPage />} />
```

(The six page files do not exist yet — create them in Tasks 6–10. To keep this task compiling on its own, create each as a stub now and replace in its task:)

```tsx
// enrollx/frontend/src/pages/ProgramsPage.tsx — same one-liner stub pattern for all six pages
export default function ProgramsPage() { return null; }
```

- [ ] **Step 7: Create `enrollx/frontend/src/utils/format.ts`:**

```ts
// enrollx/frontend/src/utils/format.ts
/** Render an ISO timestamp for tables/timelines; em dash when absent. */
export function fmtDateTime(value: unknown): string {
  if (value == null || value === '') return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

export function toBoolish(value: unknown): boolean {
  return value === true || value === 'true' || value === 'True' || value === 1;
}
```

- [ ] **Step 8: Base i18n keys.** In `enrollx/frontend/src/i18n/translations.ts`, add every key below that is not already present (Plan 1 trimmed the file; DataTable/Toast need `common.*`). Add to BOTH locale objects:

en-US:
```ts
    'nav.primary': 'Primary',
    'nav.programs': 'Programs',
    'nav.applications': 'Applications',
    'nav.settings': 'Settings',
    'nav.logout': 'Log out',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.records': 'records',
    'common.next': 'Next',
    'common.previous': 'Previous',
    'common.of': 'of',
    'common.showing': 'Showing',
    'common.to': 'to',
    'common.noResults': 'No results',
    'students.pageSize': 'Rows per page', // key name kept so the copied DataTable works unmodified
    'status.draft': 'Draft',
    'status.submitted': 'Submitted',
    'status.in_review': 'In review',
    'status.pending_items': 'Pending items',
    'status.approved': 'Approved',
    'status.enrolled': 'Enrolled',
    'status.waitlisted': 'Waitlisted',
    'status.declined': 'Declined',
    'status.withdrawn': 'Withdrawn',
    'itemStatus.not_started': 'Not started',
    'itemStatus.in_progress': 'In progress',
    'itemStatus.submitted': 'Submitted',
    'itemStatus.verified': 'Verified',
    'itemStatus.rejected': 'Rejected',
    'itemStatus.waived': 'Waived',
```

zh-CN:
```ts
    'nav.primary': '主导航',
    'nav.programs': '项目',
    'nav.applications': '报名申请',
    'nav.settings': '设置',
    'nav.logout': '退出登录',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.loading': '加载中…',
    'common.retry': '重试',
    'common.records': '条记录',
    'common.next': '下一页',
    'common.previous': '上一页',
    'common.of': '共',
    'common.showing': '显示',
    'common.to': '至',
    'common.noResults': '没有结果',
    'students.pageSize': '每页行数',
    'status.draft': '草稿',
    'status.submitted': '已提交',
    'status.in_review': '审核中',
    'status.pending_items': '待补材料',
    'status.approved': '已录取',
    'status.enrolled': '已入学',
    'status.waitlisted': '候补中',
    'status.declined': '未录取',
    'status.withdrawn': '已退出',
    'itemStatus.not_started': '未开始',
    'itemStatus.in_progress': '进行中',
    'itemStatus.submitted': '已提交',
    'itemStatus.verified': '已核验',
    'itemStatus.rejected': '已退回',
    'itemStatus.waived': '已豁免',
```

- [ ] **Step 9: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): shared UI copies, generic+registration API clients, nav and routes"
```

---

### Task 6: ProgramsPage — builder entry point

**Files:**
- Replace stub: `enrollx/frontend/src/pages/ProgramsPage.tsx`
- Create: `enrollx/frontend/src/pages/ProgramsPage.css`
- Modify: `enrollx/frontend/src/i18n/translations.ts` (keys below)

**Interfaces:**
- Consumes: `postQuery` (SQL below), route `/programs/:programId/flow` (Task 7).
- Produces: the "Design registration flow" entry per program (spec: Flow Builder is per-program).

- [ ] **Step 1: Replace `ProgramsPage.tsx`:**

```tsx
// enrollx/frontend/src/pages/ProgramsPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { postQuery } from '../api/client.ts';
import type { ProgramRow } from '../types/registration.ts';
import Button from '../components/ui/Button.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ProgramsPage.css';

export default function ProgramsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await postQuery(
        tenant,
        'entities',
        "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'",
      );
      setPrograms(res.data as unknown as ProgramRow[]);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="programs-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('programs.title')}
          <span className="page-subtitle">{programs.length} {t('common.records')}</span>
        </h1>
      </header>

      {error && (
        <div className="programs-error" role="alert">
          <span>{t('programs.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {loading && <p className="programs-muted">{t('common.loading')}</p>}

      {!loading && !error && programs.length === 0 && (
        <p className="programs-muted">{t('programs.empty')}</p>
      )}

      <ul className="programs-list">
        {programs.map((p) => (
          <li key={p.entity_id} className="program-card">
            <div className="program-card-info">
              <strong>{p.name}</strong>
              {p.description && <p>{p.description}</p>}
              <div className="program-card-meta">
                <StatusBadge status={p.status} />
                {p.capacity != null && p.capacity !== '' && (
                  <span>{t('programs.capacity')}: {String(p.capacity)}</span>
                )}
              </div>
            </div>
            <Button variant="primary"
              onClick={() => navigate(`/programs/${p.program_id}/flow`)}>
              {t('programs.designFlow')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `ProgramsPage.css`:**

```css
/* enrollx/frontend/src/pages/ProgramsPage.css */
.programs-page { padding: 20px; max-width: 960px; margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.page-title { margin: 0; font-size: 22px; color: var(--text-primary);
  display: flex; align-items: baseline; gap: 10px; }
.page-subtitle { font-size: 13px; font-weight: 400; color: var(--text-tertiary); }
.page-header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.programs-muted { color: var(--text-tertiary); }
.programs-error { display: flex; align-items: center; gap: 12px;
  background: var(--danger-muted); border: 1px solid var(--danger);
  border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 16px;
  color: var(--text-primary); }
.programs-list { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 12px; }
.program-card { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  background: var(--bg-card); border: 1px solid var(--border-primary);
  border-radius: var(--radius-md); padding: 16px 20px; }
.program-card-info { flex: 1 1 280px; min-width: 0; }
.program-card-info strong { color: var(--text-primary); font-size: 16px; }
.program-card-info p { margin: 4px 0 0; color: var(--text-secondary); font-size: 14px; }
.program-card-meta { display: flex; align-items: center; gap: 12px; margin-top: 8px;
  color: var(--text-tertiary); font-size: 13px; }
```

- [ ] **Step 3: i18n keys** (both locales):

en-US:
```ts
    'programs.title': 'Programs',
    'programs.designFlow': 'Design registration flow',
    'programs.capacity': 'Capacity',
    'programs.empty': 'No programs yet. Create programs in AdminDash first.',
    'programs.loadError': 'Could not load programs.',
```

zh-CN:
```ts
    'programs.title': '项目',
    'programs.designFlow': '设计报名流程',
    'programs.capacity': '名额',
    'programs.empty': '还没有项目。请先在 AdminDash 中创建项目。',
    'programs.loadError': '无法加载项目。',
```

- [ ] **Step 4: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): programs page with per-program flow-builder entry"
```

---

### Task 7: ConfigBuilderPage — block editor, per-block config panel, live preview, save draft, publish

The builder edits an ordered `FlowBlock[]` matching spec §4 exactly: each block is `{block_id, type, title, required, blocking, due_days_after_approval?, config}`; per-type config is `form → {entity_type? | custom_fields[]}`, `documents → {docs[]}`, `payment_plan → {currency, amount_full, plans: [{type, deposit_amount?}]}` (cents, Plan 3), `payment → {collects}`, `message → {body}`, `review → {}` (fixed, always last — the builder pins it and it is not editable/removable). Reordering is up/down buttons — no drag-drop library. Save draft = generic entity write of `registration_config`; Publish = `publish_config` action.

**Files:**
- Replace stub: `enrollx/frontend/src/pages/ConfigBuilderPage.tsx`
- Create: `enrollx/frontend/src/components/BlockConfigPanel.tsx`
- Create: `enrollx/frontend/src/pages/ConfigBuilderPage.css`
- Modify: `enrollx/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `createEntity`/`updateEntity`/`fetchNextEntityId`/`postQuery` (Task 5), `publishConfig` (CONTRACT-3), `FlowRenderer` in `mode="preview"` (Task 4), `useModel` for entity-field hydration.
- Produces: published `registration_config` entities (blocks JSON-stringified in `base_data.blocks`) — consumed by Plan 2's item derivation, Task 8's entry page, and Plan 5's public config bundle.

- [ ] **Step 1: Create `enrollx/frontend/src/components/BlockConfigPanel.tsx`:**

```tsx
// enrollx/frontend/src/components/BlockConfigPanel.tsx
import { useId } from 'react';
import type { FlowBlock, FlowField, PaymentPlanKind, PaymentPlanOption, RequiredDoc } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import Button from './ui/Button.tsx';

const ENTITY_TYPES = ['student', 'family', 'contact'] as const;
const FIELD_TYPES = ['str', 'number', 'bool', 'date', 'email', 'phone', 'selection'] as const;

interface BlockConfigPanelProps {
  block: FlowBlock;
  onChange: (next: FlowBlock) => void;
}

export default function BlockConfigPanel({ block, onChange }: BlockConfigPanelProps) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;

  const setTop = (patch: Partial<FlowBlock>) => onChange({ ...block, ...patch });
  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...block.config, ...patch } });

  const centsToDollars = (c: unknown) => (typeof c === 'number' ? c / 100 : 0);
  const dollarsToCents = (s: string) => Math.max(0, Math.round(Number(s || 0) * 100));

  // ---- form -----------------------------------------------------------
  const renderForm = () => {
    const entityType = typeof block.config.entity_type === 'string' ? block.config.entity_type : '';
    const custom = Array.isArray(block.config.custom_fields)
      ? (block.config.custom_fields as FlowField[]) : [];
    const setField = (i: number, patch: Partial<FlowField>) =>
      setCfg({ custom_fields: custom.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

    return (
      <>
        <fieldset className="bcp-fieldset">
          <legend>{t('builder.formSource')}</legend>
          <label className="bcp-choice">
            <input type="radio" name={id('src')} checked={entityType !== ''}
              onChange={() => setCfg({ entity_type: 'student', custom_fields: undefined })} />
            {t('builder.fromEntity')}
          </label>
          <label className="bcp-choice">
            <input type="radio" name={id('src')} checked={entityType === ''}
              onChange={() => setCfg({ entity_type: undefined, custom_fields: custom })} />
            {t('builder.customFields')}
          </label>
        </fieldset>

        {entityType !== '' ? (
          <div className="bcp-row">
            <label htmlFor={id('et')}>{t('builder.entityType')}</label>
            <select id={id('et')} value={entityType}
              onChange={(e) => setCfg({ entity_type: e.target.value })}>
              {ENTITY_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
            </select>
          </div>
        ) : (
          <div className="bcp-list">
            {custom.map((f, i) => (
              <div key={i} className="bcp-subrow">
                <label className="bcp-inline">
                  <span>{t('builder.fieldName')}</span>
                  <input value={f.name}
                    onChange={(e) => setField(i, { name: e.target.value })} />
                </label>
                <label className="bcp-inline">
                  <span>{t('builder.fieldType')}</span>
                  <select value={f.type}
                    onChange={(e) => setField(i, { type: e.target.value as FlowField['type'] })}>
                    {FIELD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                  </select>
                </label>
                <label className="bcp-inline bcp-check">
                  <input type="checkbox" checked={f.required}
                    onChange={(e) => setField(i, { required: e.target.checked })} />
                  <span>{t('builder.fieldRequired')}</span>
                </label>
                {f.type === 'selection' && (
                  <label className="bcp-inline">
                    <span>{t('builder.fieldOptions')}</span>
                    <input value={(f.options ?? []).join(', ')}
                      onChange={(e) => setField(i, {
                        options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                      })} />
                  </label>
                )}
                <Button variant="ghost" size="sm"
                  aria-label={`${t('builder.remove')} ${f.name || i + 1}`}
                  onClick={() => setCfg({ custom_fields: custom.filter((_, j) => j !== i) })}>
                  {t('builder.remove')}
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm"
              onClick={() => setCfg({
                custom_fields: [...custom, { name: '', type: 'str', required: false }],
              })}>
              {t('builder.addField')}
            </Button>
          </div>
        )}
      </>
    );
  };

  // ---- documents ------------------------------------------------------
  const renderDocuments = () => {
    const docs = Array.isArray(block.config.docs) ? (block.config.docs as RequiredDoc[]) : [];
    const setDoc = (i: number, patch: Partial<RequiredDoc>) =>
      setCfg({ docs: docs.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

    return (
      <div className="bcp-list">
        {docs.map((d, i) => (
          <div key={i} className="bcp-subrow">
            <label className="bcp-inline">
              <span>{t('builder.docName')}</span>
              <input value={d.name} onChange={(e) => setDoc(i, { name: e.target.value })} />
            </label>
            <label className="bcp-inline">
              <span>{t('builder.docDescription')}</span>
              <input value={d.description ?? ''}
                onChange={(e) => setDoc(i, { description: e.target.value })} />
            </label>
            <label className="bcp-inline bcp-check">
              <input type="checkbox" checked={d.sensitive}
                onChange={(e) => setDoc(i, { sensitive: e.target.checked })} />
              <span>{t('builder.docSensitive')}</span>
            </label>
            <label className="bcp-inline bcp-check">
              <input type="checkbox" checked={d.blocking}
                onChange={(e) => setDoc(i, { blocking: e.target.checked })} />
              <span>{t('builder.docBlocking')}</span>
            </label>
            {!d.blocking && (
              <label className="bcp-inline">
                <span>{t('builder.dueDays')}</span>
                <input type="number" min={0} value={d.due_days_after_approval ?? ''}
                  onChange={(e) => setDoc(i, {
                    due_days_after_approval: e.target.value === '' ? undefined : Number(e.target.value),
                  })} />
              </label>
            )}
            <Button variant="ghost" size="sm"
              aria-label={`${t('builder.remove')} ${d.name || i + 1}`}
              onClick={() => setCfg({ docs: docs.filter((_, j) => j !== i) })}>
              {t('builder.remove')}
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm"
          onClick={() => setCfg({
            docs: [...docs, { name: '', description: '', sensitive: false, blocking: true }],
          })}>
          {t('builder.addDoc')}
        </Button>
      </div>
    );
  };

  // ---- payment_plan (Plan 3 shape: {currency, amount_full, plans[{type,…}]}) --
  const renderPaymentPlan = () => {
    const plans = Array.isArray(block.config.plans)
      ? (block.config.plans as PaymentPlanOption[]) : [];
    const has = (kind: PaymentPlanKind) => plans.some((p) => p.type === kind);
    const depositCents = plans.find((p) => p.type === 'deposit')?.deposit_amount ?? 0;
    const togglePlan = (kind: PaymentPlanKind, on: boolean) => {
      const rest = plans.filter((p) => p.type !== kind);
      const added: PaymentPlanOption = kind === 'deposit'
        ? { type: 'deposit', deposit_amount: depositCents }
        : { type: 'pay_in_full' };
      setCfg({ currency: 'usd', plans: on ? [...rest, added] : rest });
    };

    return (
      <div className="bcp-list">
        <fieldset className="bcp-fieldset">
          <legend>{t('builder.plansOffered')}</legend>
          <label className="bcp-choice">
            <input type="checkbox" checked={has('pay_in_full')}
              onChange={(e) => togglePlan('pay_in_full', e.target.checked)} />
            {t('builder.planPayInFull')}
          </label>
          <label className="bcp-choice">
            <input type="checkbox" checked={has('deposit')}
              onChange={(e) => togglePlan('deposit', e.target.checked)} />
            {t('builder.planDeposit')}
          </label>
        </fieldset>
        <div className="bcp-row">
          <label htmlFor={id('af')}>{t('builder.amountFull')}</label>
          <input id={id('af')} type="number" min={0} step="0.01"
            value={centsToDollars(block.config.amount_full)}
            onChange={(e) => setCfg({ amount_full: dollarsToCents(e.target.value) })} />
        </div>
        {has('deposit') && (
          <div className="bcp-row">
            <label htmlFor={id('ad')}>{t('builder.depositAmount')}</label>
            <input id={id('ad')} type="number" min={0} step="0.01"
              value={centsToDollars(depositCents)}
              onChange={(e) => setCfg({
                plans: plans.map((p) => p.type === 'deposit'
                  ? { ...p, deposit_amount: dollarsToCents(e.target.value) } : p),
              })} />
          </div>
        )}
      </div>
    );
  };

  // ---- payment / message ------------------------------------------------
  const renderPayment = () => (
    <div className="bcp-row">
      <label htmlFor={id('col')}>{t('builder.collects')}</label>
      <select id={id('col')}
        value={typeof block.config.collects === 'string' ? block.config.collects : 'full'}
        onChange={(e) => setCfg({ collects: e.target.value })}>
        <option value="full">full</option>
        <option value="deposit">deposit</option>
      </select>
    </div>
  );

  const renderMessage = () => (
    <div className="bcp-row bcp-row--stack">
      <label htmlFor={id('body')}>{t('builder.messageBody')}</label>
      <textarea id={id('body')} rows={6}
        value={typeof block.config.body === 'string' ? block.config.body : ''}
        onChange={(e) => setCfg({ body: e.target.value })} />
    </div>
  );

  return (
    <div className="bcp">
      <div className="bcp-row">
        <label htmlFor={id('title')}>{t('builder.blockTitle')}</label>
        <input id={id('title')} value={block.title}
          onChange={(e) => setTop({ title: e.target.value })} />
      </div>
      <label className="bcp-inline bcp-check">
        <input type="checkbox" checked={block.blocking}
          onChange={(e) => setTop({ blocking: e.target.checked, required: e.target.checked })} />
        <span>{t('builder.blocking')}</span>
      </label>
      {!block.blocking && (
        <div className="bcp-row">
          <label htmlFor={id('due')}>{t('builder.dueDays')}</label>
          <input id={id('due')} type="number" min={0}
            value={block.due_days_after_approval ?? ''}
            onChange={(e) => setTop({
              due_days_after_approval: e.target.value === '' ? undefined : Number(e.target.value),
            })} />
        </div>
      )}

      {block.type === 'form' && renderForm()}
      {block.type === 'documents' && renderDocuments()}
      {block.type === 'payment_plan' && renderPaymentPlan()}
      {block.type === 'payment' && renderPayment()}
      {block.type === 'message' && renderMessage()}
    </div>
  );
}
```

- [ ] **Step 2: Replace `enrollx/frontend/src/pages/ConfigBuilderPage.tsx`:**

```tsx
// enrollx/frontend/src/pages/ConfigBuilderPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FlowRenderer } from '@neoapex/flow-runtime';
import type {
  BlockType, FlowBlock, RegistrationConfigDef, RequiredDoc,
} from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import type { ModelDefinition } from '../types/models.ts';
import { createEntity, escapeSql, fetchNextEntityId, postQuery, updateEntity } from '../api/client.ts';
import { publishConfig } from '../api/registration.ts';
import type { ConfigRow, ProgramRow } from '../types/registration.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import BlockConfigPanel from '../components/BlockConfigPanel.tsx';
import './ConfigBuilderPage.css';

const ADDABLE: BlockType[] = ['form', 'documents', 'payment_plan', 'payment', 'message'];

function newBlockId(): string {
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function newBlock(type: BlockType, title: string): FlowBlock {
  const base = { block_id: newBlockId(), type, title, required: true, blocking: true };
  switch (type) {
    case 'form': return { ...base, config: { custom_fields: [] } };
    case 'documents': return { ...base, config: { docs: [] } };
    case 'payment_plan':
      return {
        ...base,
        config: { currency: 'usd', amount_full: 0, plans: [{ type: 'pay_in_full' }] },
      };
    case 'payment': return { ...base, config: { collects: 'full' } };
    case 'message': return { ...base, blocking: false, required: false, config: { body: '' } };
    default: return { ...base, config: {} };
  }
}

/** Spec §4: review is fixed and always last. */
function withReview(blocks: FlowBlock[], reviewTitle: string): FlowBlock[] {
  return [...blocks, {
    block_id: 'blk_review', type: 'review', title: reviewTitle,
    required: true, blocking: true, config: {},
  }];
}

export default function ConfigBuilderPage() {
  const { programId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const { getModel } = useModel();

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [blocks, setBlocks] = useState<FlowBlock[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [configStatus, setConfigStatus] = useState<'draft' | 'published'>('draft');
  const [addType, setAddType] = useState<BlockType>('form');
  const [models, setModels] = useState<Record<string, ModelDefinition>>({});
  const [saving, setSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const pr = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active' AND program_id = '${escapeSql(programId)}'`);
      setProgram((pr.data[0] as unknown as ProgramRow) ?? null);

      const cr = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active' AND program_id = '${escapeSql(programId)}'`);
      const rows = cr.data as unknown as ConfigRow[];
      const latest = rows.sort((a, b) => Number(b.version) - Number(a.version))[0];
      if (latest) {
        setEntityId(latest.entity_id);
        setConfigId(latest.config_id);
        setVersion(Number(latest.version));
        setConfigStatus(latest.status === 'published' ? 'published' : 'draft');
        const parsed = JSON.parse(String(latest.blocks)) as FlowBlock[];
        setBlocks(parsed.filter((b) => b.type !== 'review'));
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [tenant, programId]);

  useEffect(() => { void load(); }, [load]);

  // Hydrate entity-model fields for the preview (host responsibility).
  useEffect(() => {
    for (const b of blocks) {
      const et = b.type === 'form' && typeof b.config.entity_type === 'string'
        ? b.config.entity_type : null;
      if (et && !models[et]) {
        getModel(tenant, et)
          .then((m) => setModels((prev) => ({ ...prev, [et]: m })))
          .catch(() => { /* model not configured — preview shows noFields */ });
      }
    }
  }, [blocks, models, tenant, getModel]);

  const previewConfig: RegistrationConfigDef = useMemo(() => ({
    config_id: configId ?? 'preview',
    program_id: programId,
    version,
    status: 'draft',
    blocks: withReview(blocks, t('builder.reviewTitle')).map((b) => {
      const et = b.type === 'form' && typeof b.config.entity_type === 'string'
        ? b.config.entity_type : null;
      if (!et) return b;
      const m = models[et];
      const fields = m
        ? [...m.base_fields, ...m.custom_fields].filter((f) => f.name !== `${et}_id`)
        : [];
      return { ...b, config: { ...b.config, fields } };
    }),
  }), [blocks, models, configId, programId, version, t]);

  const noopSave = async (_v: Record<string, unknown>) => {};
  const noopItem = async (_id: string, _p?: Record<string, unknown>) => {};
  const noopUpload = async (_b: string, _d: RequiredDoc, _f: File) => {};
  const noopCheckout = async (_id: string) => {};
  const noopSubmit = async () => {};

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
    setSelected(j);
  };

  const saveDraft = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const blocksJson = JSON.stringify(withReview(blocks, t('builder.reviewTitle')));
      // Publishing archives the old row (Plan 2); a published config gets a
      // NEW draft row at version+1 instead of being edited in place.
      if (entityId && configStatus === 'draft') {
        await updateEntity(tenant, 'registration_config', entityId, {
          config_id: configId, program_id: programId, version,
          status: 'draft', blocks: blocksJson,
        });
        toast({ message: t('builder.savedDraft'), tone: 'success' });
        return configId;
      }
      const nextVersion = entityId ? version + 1 : 1;
      const cid = configId ?? (await fetchNextEntityId(tenant, 'registration_config')).next_id;
      const created = await createEntity(tenant, 'registration_config', {
        config_id: cid, program_id: programId, version: nextVersion,
        status: 'draft', blocks: blocksJson,
      });
      setEntityId(created.entity_id);
      setConfigId(cid);
      setVersion(nextVersion);
      setConfigStatus('draft');
      toast({ message: t('builder.savedDraft'), tone: 'success' });
      return cid;
    } catch (e) {
      toast({ message: t('builder.saveError'), detail: String(e), tone: 'danger' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const doPublish = async () => {
    setConfirmPublish(false);
    const cid = await saveDraft();
    if (!cid) return;
    try {
      await publishConfig(tenant, cid);
      setConfigStatus('published');
      toast({ message: t('builder.published'), tone: 'success' });
      void load();
    } catch (e) {
      toast({ message: t('builder.publishError'), detail: String(e), tone: 'danger' });
    }
  };

  return (
    <div className="builder-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('builder.title')}
          <span className="page-subtitle">
            {program?.name ?? programId} · {t('builder.version')} {version} ·{' '}
            {configStatus === 'published' ? t('status.published') : t('status.draft')}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="secondary" loading={saving} loadingText={t('common.loading')}
            onClick={() => void saveDraft()}>
            {t('builder.saveDraft')}
          </Button>
          <Button variant="primary" disabled={saving || blocks.length === 0}
            onClick={() => setConfirmPublish(true)}>
            {t('builder.publish')}
          </Button>
        </div>
      </header>

      {error && <div className="programs-error" role="alert">{error}</div>}

      <div className="builder-columns">
        <section className="builder-list" aria-label={t('builder.blocksHeading')}>
          <h2>{t('builder.blocksHeading')}</h2>
          <ol>
            {blocks.map((b, i) => (
              <li key={b.block_id}
                className={i === selected ? 'builder-row builder-row--selected' : 'builder-row'}>
                <button type="button" className="builder-row-main" onClick={() => setSelected(i)}>
                  <span className="builder-row-type">{t(`builder.blockType.${b.type}`)}</span>
                  <span className="builder-row-title">{b.title}</span>
                </button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.moveUp')}: ${b.title}`}
                  disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.moveDown')}: ${b.title}`}
                  disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Button variant="ghost" size="sm" icon aria-label={`${t('builder.remove')}: ${b.title}`}
                  onClick={() => {
                    setBlocks(blocks.filter((_, j) => j !== i));
                    setSelected(-1);
                  }}>×</Button>
              </li>
            ))}
            <li className="builder-row builder-row--fixed">
              <span className="builder-row-type">{t('builder.blockType.review')}</span>
              <span className="builder-row-title">{t('builder.reviewTitle')} ({t('builder.fixedLast')})</span>
            </li>
          </ol>
          <div className="builder-add">
            <label htmlFor="builder-add-type">{t('builder.addBlock')}</label>
            <select id="builder-add-type" value={addType}
              onChange={(e) => setAddType(e.target.value as BlockType)}>
              {ADDABLE.map((bt) => (
                <option key={bt} value={bt}>{t(`builder.blockType.${bt}`)}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => {
              const b = newBlock(addType, t(`builder.blockType.${addType}`));
              setBlocks([...blocks, b]);
              setSelected(blocks.length);
            }}>
              {t('builder.add')}
            </Button>
          </div>
        </section>

        <section className="builder-panel" aria-label={t('builder.settingsHeading')}>
          <h2>{t('builder.settingsHeading')}</h2>
          {selected >= 0 && blocks[selected] ? (
            <BlockConfigPanel block={blocks[selected]}
              onChange={(nb) => setBlocks(blocks.map((b, i) => (i === selected ? nb : b)))} />
          ) : (
            <p className="programs-muted">{t('builder.selectBlock')}</p>
          )}
        </section>

        <section className="builder-preview" aria-label={t('builder.preview')}>
          <h2>{t('builder.preview')}</h2>
          <FlowRenderer config={previewConfig} mode="preview" application={null} items={[]}
            values={{}} onSaveDraft={noopSave} onCompleteItem={noopItem}
            onUploadDocument={noopUpload} onCheckout={noopCheckout} onSubmit={noopSubmit} />
        </section>
      </div>

      <Modal open={confirmPublish} onClose={() => setConfirmPublish(false)}
        title={t('builder.publishConfirmTitle')} size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doPublish()}>
              {t('builder.publish')}
            </Button>
          </>
        }>
        <p>{t('builder.publishConfirmBody')}</p>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Create `ConfigBuilderPage.css`:**

```css
/* enrollx/frontend/src/pages/ConfigBuilderPage.css */
.builder-page { padding: 20px; }
.builder-columns { display: grid; grid-template-columns: 300px 1fr 1.2fr; gap: 16px;
  align-items: start; }
@media (max-width: 1100px) { .builder-columns { grid-template-columns: 1fr; } }
.builder-list, .builder-panel, .builder-preview { background: var(--bg-card);
  border: 1px solid var(--border-primary); border-radius: var(--radius-md); padding: 16px; }
.builder-list h2, .builder-panel h2, .builder-preview h2 { margin: 0 0 12px;
  font-size: 14px; color: var(--text-secondary); text-transform: uppercase;
  letter-spacing: 0.04em; }
.builder-list ol { list-style: none; margin: 0 0 12px; padding: 0;
  display: flex; flex-direction: column; gap: 6px; }
.builder-row { display: flex; align-items: center; gap: 4px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 4px; }
.builder-row--selected { border-color: var(--accent); }
.builder-row--fixed { color: var(--text-tertiary); padding: 8px; gap: 8px; }
.builder-row-main { flex: 1; display: flex; flex-direction: column; align-items: flex-start;
  gap: 2px; border: 0; background: none; font: inherit; text-align: left;
  cursor: pointer; padding: 4px 6px; min-width: 0; }
.builder-row-type { font-size: 11px; color: var(--accent-ink); text-transform: uppercase; }
.builder-row-title { font-size: 14px; color: var(--text-primary); }
.builder-add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.builder-add label { font-size: 13px; color: var(--text-secondary); }
.builder-add select, .bcp select, .bcp input, .bcp textarea {
  border: 1px solid var(--border-primary); border-radius: var(--radius-sm);
  background: var(--bg-input); color: var(--text-primary); font: inherit;
  font-size: 14px; padding: 6px 8px; }
.builder-add select:focus-visible, .bcp select:focus-visible, .bcp input:focus-visible,
.bcp textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.bcp { display: flex; flex-direction: column; gap: 12px; }
.bcp-row { display: flex; align-items: center; gap: 10px; }
.bcp-row--stack { flex-direction: column; align-items: stretch; }
.bcp-row label { font-size: 13px; color: var(--text-secondary); min-width: 120px; }
.bcp-fieldset { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  padding: 8px 12px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.bcp-fieldset legend { font-size: 13px; color: var(--text-secondary); }
.bcp-choice, .bcp-check { display: flex; align-items: center; gap: 8px; font-size: 14px;
  color: var(--text-primary); }
.bcp-list { display: flex; flex-direction: column; gap: 10px; }
.bcp-subrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm); padding: 8px; }
.bcp-inline { display: flex; align-items: center; gap: 6px; font-size: 13px;
  color: var(--text-secondary); }
.bcp-inline input, .bcp-inline select { max-width: 160px; }
```

- [ ] **Step 4: i18n keys** (both locales):

en-US:
```ts
    'builder.title': 'Registration flow',
    'builder.version': 'Version',
    'status.published': 'Published',
    'builder.blocksHeading': 'Flow steps',
    'builder.settingsHeading': 'Step settings',
    'builder.preview': 'Live preview',
    'builder.addBlock': 'Add step',
    'builder.add': 'Add',
    'builder.blockType.form': 'Form',
    'builder.blockType.documents': 'Documents',
    'builder.blockType.payment_plan': 'Payment plan',
    'builder.blockType.payment': 'Payment',
    'builder.blockType.message': 'Message',
    'builder.blockType.review': 'Review',
    'builder.reviewTitle': 'Review & submit',
    'builder.fixedLast': 'always last',
    'builder.moveUp': 'Move up',
    'builder.moveDown': 'Move down',
    'builder.remove': 'Remove',
    'builder.blockTitle': 'Title',
    'builder.blocking': 'Must be completed before submission',
    'builder.dueDays': 'Days due after approval',
    'builder.formSource': 'Field source',
    'builder.fromEntity': 'From entity model',
    'builder.customFields': 'Custom fields',
    'builder.entityType': 'Entity type',
    'builder.addField': 'Add field',
    'builder.fieldName': 'Field name',
    'builder.fieldType': 'Type',
    'builder.fieldRequired': 'Required',
    'builder.fieldOptions': 'Options (comma-separated)',
    'builder.addDoc': 'Add document',
    'builder.docName': 'Document name',
    'builder.docDescription': 'Description',
    'builder.docSensitive': 'Sensitive (medical etc.)',
    'builder.docBlocking': 'Required before submission',
    'builder.plansOffered': 'Plans offered',
    'builder.planPayInFull': 'Pay in full',
    'builder.planDeposit': 'Deposit',
    'builder.amountFull': 'Full amount (USD)',
    'builder.depositAmount': 'Deposit amount (USD)',
    'builder.collects': 'Collects',
    'builder.messageBody': 'Message text',
    'builder.selectBlock': 'Select a step to edit its settings.',
    'builder.saveDraft': 'Save draft',
    'builder.publish': 'Publish',
    'builder.savedDraft': 'Draft saved.',
    'builder.published': 'Flow published.',
    'builder.saveError': 'Could not save the draft.',
    'builder.publishError': 'Could not publish the flow.',
    'builder.publishConfirmTitle': 'Publish this flow?',
    'builder.publishConfirmBody': 'New applications for this program will use this version. Applications already in progress keep the version they started with.',
```

zh-CN:
```ts
    'builder.title': '报名流程',
    'builder.version': '版本',
    'status.published': '已发布',
    'builder.blocksHeading': '流程步骤',
    'builder.settingsHeading': '步骤设置',
    'builder.preview': '实时预览',
    'builder.addBlock': '添加步骤',
    'builder.add': '添加',
    'builder.blockType.form': '表单',
    'builder.blockType.documents': '文件材料',
    'builder.blockType.payment_plan': '付款方式',
    'builder.blockType.payment': '付款',
    'builder.blockType.message': '说明信息',
    'builder.blockType.review': '确认提交',
    'builder.reviewTitle': '确认并提交',
    'builder.fixedLast': '固定为最后一步',
    'builder.moveUp': '上移',
    'builder.moveDown': '下移',
    'builder.remove': '移除',
    'builder.blockTitle': '标题',
    'builder.blocking': '提交前必须完成',
    'builder.dueDays': '录取后期限（天）',
    'builder.formSource': '字段来源',
    'builder.fromEntity': '来自实体模型',
    'builder.customFields': '自定义字段',
    'builder.entityType': '实体类型',
    'builder.addField': '添加字段',
    'builder.fieldName': '字段名',
    'builder.fieldType': '类型',
    'builder.fieldRequired': '必填',
    'builder.fieldOptions': '选项（逗号分隔）',
    'builder.addDoc': '添加文件',
    'builder.docName': '文件名称',
    'builder.docDescription': '说明',
    'builder.docSensitive': '敏感（医疗等）',
    'builder.docBlocking': '提交前必须上传',
    'builder.plansOffered': '提供的付款方式',
    'builder.planPayInFull': '全额付款',
    'builder.planDeposit': '定金',
    'builder.amountFull': '全额金额（美元）',
    'builder.depositAmount': '定金金额（美元）',
    'builder.collects': '收取',
    'builder.messageBody': '说明文字',
    'builder.selectBlock': '选择一个步骤进行设置。',
    'builder.saveDraft': '保存草稿',
    'builder.publish': '发布',
    'builder.savedDraft': '草稿已保存。',
    'builder.published': '流程已发布。',
    'builder.saveError': '草稿保存失败。',
    'builder.publishError': '流程发布失败。',
    'builder.publishConfirmTitle': '发布该流程？',
    'builder.publishConfirmBody': '该项目的新申请将使用此版本。已在进行中的申请仍使用其开始时的版本。',
```

- [ ] **Step 5: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): flow builder — block editor, per-type config panel, live preview, publish"
```

---

### Task 8: Staff-assisted entry — NewApplicationPage + ApplicationEntryPage

**Files:**
- Replace stubs: `enrollx/frontend/src/pages/NewApplicationPage.tsx`, `enrollx/frontend/src/pages/ApplicationEntryPage.tsx`
- Create: `enrollx/frontend/src/pages/ApplicationEntryPage.css`
- Modify: `enrollx/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `POST /api/registration/{tenant}/applications` (roadmap), actions `save_draft`/`complete_item`/`submit`/`record_offline_payment` (CONTRACT-2 spellings), `uploadDocumentForItem` + document proxy, `startCheckout` (CONTRACT-4), `FlowRenderer mode="staff"`.
- Produces: the staff channel of spec §6 — enter data on behalf of a family, upload scanned paper forms, record offline payments; also the "Continue entry" target used by Task 10.

- [ ] **Step 1: Replace `NewApplicationPage.tsx`:**

```tsx
// enrollx/frontend/src/pages/NewApplicationPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { postQuery } from '../api/client.ts';
import { createApplication } from '../api/registration.ts';
import type { ProgramRow } from '../types/registration.ts';
import Button from '../components/ui/Button.tsx';
import './ProgramsPage.css';

function defaultSchoolYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

export default function NewApplicationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [programId, setProgramId] = useState('');
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'")
      .then((res) => {
        const rows = res.data as unknown as ProgramRow[];
        setPrograms(rows);
        if (rows[0]) setProgramId(rows[0].program_id);
      })
      .catch((e) => toast({ message: t('programs.loadError'), detail: String(e), tone: 'danger' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const create = async () => {
    if (!programId || !schoolYear.trim()) return;
    setCreating(true);
    try {
      const app = await createApplication(tenant, {
        program_id: programId,
        school_year: schoolYear.trim(),
        channel: 'admin',
        ...(email.trim() ? { applicant_email: email.trim() } : {}),
      });
      toast({ message: t('newApp.created'), tone: 'success' });
      navigate(`/applications/${app.application_id}/enter`);
    } catch (e) {
      toast({ message: t('newApp.createError'), detail: String(e), tone: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="programs-page">
      <header className="page-header">
        <h1 className="page-title">{t('newApp.title')}</h1>
      </header>
      <form className="program-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
        onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="bcp-row">
          <label htmlFor="newapp-program">{t('newApp.program')}</label>
          <select id="newapp-program" value={programId} required
            onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => (
              <option key={p.program_id} value={p.program_id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="bcp-row">
          <label htmlFor="newapp-year">{t('newApp.schoolYear')}</label>
          <input id="newapp-year" value={schoolYear} required
            onChange={(e) => setSchoolYear(e.target.value)} />
        </div>
        <div className="bcp-row">
          <label htmlFor="newapp-email">{t('newApp.applicantEmail')}</label>
          <input id="newapp-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Button variant="primary" type="submit" loading={creating}
            loadingText={t('common.loading')}>
            {t('newApp.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

(The `bcp-row` classes come from `ConfigBuilderPage.css`, which is imported app-wide once Task 7 lands; if lint flags the cross-page class use, duplicate the two rules into `ProgramsPage.css` instead — do not inline styles beyond the single layout override above.)

- [ ] **Step 2: Replace `ApplicationEntryPage.tsx`:**

```tsx
// enrollx/frontend/src/pages/ApplicationEntryPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FlowRenderer } from '@neoapex/flow-runtime';
import type {
  ApplicationSummary, FlowBlock, RegistrationConfigDef, RequiredDoc,
} from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { escapeSql, postQuery } from '../api/client.ts';
import { postApplicationAction, startCheckout, uploadDocumentForItem } from '../api/registration.ts';
import type { ApplicationRow, ConfigRow, ItemRow } from '../types/registration.ts';
import { toBoolish } from '../utils/format.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationEntryPage.css';

export default function ApplicationEntryPage() {
  const { applicationId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const { getModel } = useModel();
  const navigate = useNavigate();

  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [config, setConfig] = useState<RegistrationConfigDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineItemId, setOfflineItemId] = useState<string | null>(null);
  const [offlineAmount, setOfflineAmount] = useState('');
  const [offlineNote, setOfflineNote] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);

  const loadAppAndItems = useCallback(async () => {
    const ar = await postQuery(tenant, 'entities',
      `SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
    const a = (ar.data[0] as unknown as ApplicationRow) ?? null;
    setApp(a);
    const ir = await postQuery(tenant, 'entities',
      `SELECT * FROM data WHERE entity_type = 'application_item' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
    setItems(ir.data as unknown as ItemRow[]);
    return a;
  }, [tenant, applicationId]);

  useEffect(() => {
    (async () => {
      try {
        const a = await loadAppAndItems();
        if (!a) { setError(t('entry.notFound')); return; }
        const cr = await postQuery(tenant, 'entities',
          `SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active' AND program_id = '${escapeSql(String(a.program_id))}'`);
        const rows = cr.data as unknown as ConfigRow[];
        // The application pins config_version at start (spec §4).
        const cfg = rows.find((c) => Number(c.version) === Number(a.config_version))
          ?? rows.sort((x, y) => Number(y.version) - Number(x.version))[0];
        if (!cfg) { setError(t('entry.noConfig')); return; }
        const blocks = JSON.parse(String(cfg.blocks)) as FlowBlock[];
        // Host responsibility: hydrate entity-model-sourced form fields.
        const hydrated = await Promise.all(blocks.map(async (b) => {
          const et = b.type === 'form' && typeof b.config.entity_type === 'string'
            ? b.config.entity_type : null;
          if (!et) return b;
          try {
            const m = await getModel(tenant, et);
            const fields = [...m.base_fields, ...m.custom_fields]
              .filter((f) => f.name !== `${et}_id`);
            return { ...b, config: { ...b.config, fields } };
          } catch {
            return { ...b, config: { ...b.config, fields: [] } };
          }
        }));
        setConfig({
          config_id: String(cfg.config_id), program_id: String(cfg.program_id),
          version: Number(cfg.version), status: 'published', blocks: hydrated,
        });
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [tenant, applicationId, loadAppAndItems, getModel, t]);

  const values = useMemo(() => {
    try {
      return app?.draft_data ? JSON.parse(String(app.draft_data)) as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }, [app?.draft_data]);

  const rendererItems = useMemo(() => items.map((i) => ({
    item_id: i.item_id, application_id: i.application_id, block_id: i.block_id,
    kind: i.kind, title: i.title, status: i.status, blocking: toBoolish(i.blocking),
    due_at: i.due_at, completed_by: i.completed_by, payload_ref: i.payload_ref,
  })), [items]);

  const summary: ApplicationSummary | null = app ? {
    application_id: app.application_id, program_id: app.program_id,
    school_year: app.school_year, status: app.status,
    channel_started: app.channel_started, config_version: Number(app.config_version),
    applicant_email: app.applicant_email,
  } : null;

  // ---- FlowRenderer callbacks (all report failures; CONTRACT-2 spellings) --
  const handleSaveDraft = async (v: Record<string, unknown>) => {
    try {
      await postApplicationAction(tenant, applicationId, 'save_draft', { draft_data: v });
    } catch (e) {
      toast({ message: t('entry.saveError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  const handleCompleteItem = async (itemId: string, payload?: Record<string, unknown>) => {
    try {
      await postApplicationAction(tenant, applicationId, 'complete_item',
        { item_id: itemId, ...(payload ? { payload } : {}) });
      await loadAppAndItems();
      toast({ message: t('entry.itemCompleted'), tone: 'success' });
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  const handleUploadDocument = async (blockId: string, doc: RequiredDoc, file: File) => {
    const item = items.find((i) => i.block_id === blockId && i.title === doc.name);
    if (!item) { toast({ message: t('entry.uploadError'), tone: 'danger' }); return; }
    try {
      await uploadDocumentForItem(tenant, applicationId, item.item_id, doc, file);
      await loadAppAndItems();
      toast({ message: t('entry.uploaded'), tone: 'success' });
    } catch (e) {
      toast({ message: t('entry.uploadError'), detail: String(e), tone: 'danger' });
    }
  };

  const handleCheckout = async (itemId: string) => {
    try {
      const { checkout_url } = await startCheckout(tenant, applicationId, itemId);
      window.open(checkout_url, '_blank', 'noopener');
    } catch (e) {
      toast({ message: t('entry.checkoutError'), detail: String(e), tone: 'danger' });
    }
  };

  const handleSubmit = async () => {
    try {
      await postApplicationAction(tenant, applicationId, 'submit', {});
      toast({ message: t('entry.submitted'), tone: 'success' });
      navigate(`/applications/${applicationId}`);
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
      throw e;
    }
  };

  const recordOffline = async () => {
    if (!offlineItemId) return;
    setOfflineBusy(true);
    try {
      await postApplicationAction(tenant, applicationId, 'record_offline_payment', {
        item_id: offlineItemId,
        amount: Math.round(Number(offlineAmount || 0) * 100), // dollars → cents
        ...(offlineNote.trim() ? { note: offlineNote.trim() } : {}),
      });
      setOfflineItemId(null);
      setOfflineAmount('');
      setOfflineNote('');
      await loadAppAndItems();
      toast({ message: t('entry.offlineRecorded'), tone: 'success' });
    } catch (e) {
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
    } finally {
      setOfflineBusy(false);
    }
  };

  if (error) return <div className="entry-page"><div className="programs-error" role="alert">{error}</div></div>;
  if (!app || !config || !summary) return <div className="entry-page"><p className="programs-muted">{t('common.loading')}</p></div>;

  return (
    <div className="entry-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('entry.title')}
          <span className="page-subtitle">{app.application_id} · {app.school_year}</span>
        </h1>
        <div className="page-header-actions">
          <StatusBadge status={app.status} label={t(`status.${app.status}`)} />
          <Button variant="secondary" onClick={() => navigate(`/applications/${applicationId}`)}>
            {t('entry.viewDetail')}
          </Button>
        </div>
      </header>

      <FlowRenderer
        config={config}
        mode="staff"
        application={summary}
        items={rendererItems}
        values={values}
        onSaveDraft={handleSaveDraft}
        onCompleteItem={handleCompleteItem}
        onUploadDocument={handleUploadDocument}
        onCheckout={handleCheckout}
        onSubmit={handleSubmit}
        onRecordOfflinePayment={(itemId) => setOfflineItemId(itemId)}
      />

      <Modal open={offlineItemId != null} onClose={() => setOfflineItemId(null)}
        title={t('entry.offlineTitle')} size="sm" dismissOnEscape={!offlineBusy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOfflineItemId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={offlineBusy} loadingText={t('common.loading')}
              disabled={!offlineAmount || Number(offlineAmount) <= 0}
              onClick={() => void recordOffline()}>
              {t('entry.offlineTitle')}
            </Button>
          </>
        }>
        <div className="bcp-row">
          <label htmlFor="offline-amount">{t('entry.offlineAmount')}</label>
          <input id="offline-amount" type="number" min={0} step="0.01" value={offlineAmount}
            onChange={(e) => setOfflineAmount(e.target.value)} />
        </div>
        <div className="bcp-row">
          <label htmlFor="offline-note">{t('entry.offlineNote')}</label>
          <input id="offline-note" value={offlineNote}
            onChange={(e) => setOfflineNote(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Create `ApplicationEntryPage.css`:**

```css
/* enrollx/frontend/src/pages/ApplicationEntryPage.css */
.entry-page { padding: 20px; max-width: 900px; margin: 0 auto; }
```

- [ ] **Step 4: i18n keys** (both locales):

en-US:
```ts
    'newApp.title': 'New application',
    'newApp.program': 'Program',
    'newApp.schoolYear': 'School year',
    'newApp.applicantEmail': 'Parent email (optional)',
    'newApp.create': 'Create application',
    'newApp.created': 'Application created.',
    'newApp.createError': 'Could not create the application.',
    'entry.title': 'Application entry',
    'entry.viewDetail': 'View detail',
    'entry.notFound': 'Application not found.',
    'entry.noConfig': 'No registration flow is published for this program.',
    'entry.saveError': 'Could not save the draft.',
    'entry.itemCompleted': 'Step saved.',
    'entry.uploaded': 'Document uploaded.',
    'entry.uploadError': 'Upload failed.',
    'entry.checkoutError': 'Could not start checkout.',
    'entry.submitted': 'Application submitted.',
    'entry.offlineTitle': 'Record offline payment',
    'entry.offlineAmount': 'Amount (USD)',
    'entry.offlineNote': 'Note (check no., etc.)',
    'entry.offlineRecorded': 'Offline payment recorded.',
```

zh-CN:
```ts
    'newApp.title': '新建申请',
    'newApp.program': '项目',
    'newApp.schoolYear': '学年',
    'newApp.applicantEmail': '家长邮箱（可选）',
    'newApp.create': '创建申请',
    'newApp.created': '申请已创建。',
    'newApp.createError': '申请创建失败。',
    'entry.title': '申请录入',
    'entry.viewDetail': '查看详情',
    'entry.notFound': '未找到该申请。',
    'entry.noConfig': '该项目尚未发布报名流程。',
    'entry.saveError': '草稿保存失败。',
    'entry.itemCompleted': '该步骤已保存。',
    'entry.uploaded': '文件已上传。',
    'entry.uploadError': '上传失败。',
    'entry.checkoutError': '无法发起支付。',
    'entry.submitted': '申请已提交。',
    'entry.offlineTitle': '记录线下付款',
    'entry.offlineAmount': '金额（美元）',
    'entry.offlineNote': '备注（支票号等）',
    'entry.offlineRecorded': '线下付款已记录。',
```

- [ ] **Step 5: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): staff-assisted entry — create application, FlowRenderer host, offline payment"
```

---

### Task 9: ApplicationsPage — table + Kanban toggle, filters, counts

All data arrives through one generic query (spec §10 — no bespoke read APIs; the same SQL is available to the AI chatbot). Counts and filtering are computed client-side from the fetched rows: DataCore's query passthrough is only guaranteed for plain `SELECT … WHERE …` over `data`, so we do not rely on `GROUP BY`/`ORDER BY` support server-side.

**Files:**
- Replace stub: `enrollx/frontend/src/pages/ApplicationsPage.tsx`
- Create: `enrollx/frontend/src/pages/ApplicationsPage.css`
- Modify: `enrollx/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `postQuery` with the SQL below; `DataTable` and `StatusBadge` copies (Task 5).
- Produces: `/applications` list (leads-page pattern) linking to Task 10's detail and Task 8's new-application page.

- [ ] **Step 1: Replace `ApplicationsPage.tsx`.** The exact SQL (single quotes escaped via `escapeSql`; filters appended only when set):

```sql
SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' LIMIT 1000
-- optional appended filters, before LIMIT:
--   AND program_id = '<programId>'
--   AND school_year = '<schoolYear>'
--   AND status = '<status>'
SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'
```

```tsx
// enrollx/frontend/src/pages/ApplicationsPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApplicationStatus } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { escapeSql, postQuery } from '../api/client.ts';
import type { ApplicationRow, ProgramRow } from '../types/registration.ts';
import { fmtDateTime } from '../utils/format.ts';
import Button from '../components/ui/Button.tsx';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationsPage.css';

const STATUS_ORDER: ApplicationStatus[] = [
  'draft', 'submitted', 'in_review', 'pending_items', 'approved',
  'enrolled', 'waitlisted', 'declined', 'withdrawn',
];

const PAGE_SIZE = 20;

export default function ApplicationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const navigate = useNavigate();

  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [programFilter, setProgramFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const where = [
        "entity_type = 'registration_application'",
        "_status = 'active'",
        programFilter ? `program_id = '${escapeSql(programFilter)}'` : null,
        yearFilter ? `school_year = '${escapeSql(yearFilter)}'` : null,
        statusFilter ? `status = '${escapeSql(statusFilter)}'` : null,
      ].filter(Boolean).join(' AND ');
      const res = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE ${where} LIMIT 1000`);
      const data = res.data as unknown as ApplicationRow[];
      // Client-side ordering: newest submissions first, drafts at the top.
      data.sort((a, b) => String(b.submitted_at ?? '9999').localeCompare(String(a.submitted_at ?? '9999')));
      setRows(data);
      setError(null);
      setPage(1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tenant, programFilter, yearFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'")
      .then((res) => setPrograms(res.data as unknown as ProgramRow[]))
      .catch(() => setPrograms([]));
  }, [tenant]);

  const programName = useCallback(
    (pid: string) => programs.find((p) => p.program_id === pid)?.name ?? pid,
    [programs],
  );

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.school_year))).sort().reverse(),
    [rows],
  );

  const countsByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [rows]);

  const columns: Column<ApplicationRow>[] = useMemo(() => [
    {
      key: 'application_id', label: 'Application', i18nKey: 'apps.colId', primary: true,
      render: (r) => (
        <button type="button" className="apps-link"
          onClick={() => navigate(`/applications/${r.application_id}`)}>
          {r.application_id}
        </button>
      ),
    },
    { key: 'program_id', label: 'Program', i18nKey: 'apps.colProgram',
      render: (r) => programName(r.program_id) },
    { key: 'school_year', label: 'School year', i18nKey: 'apps.colYear' },
    { key: 'status', label: 'Status', i18nKey: 'apps.colStatus',
      render: (r) => <StatusBadge status={r.status} label={t(`status.${r.status}`)} /> },
    { key: 'channel_started', label: 'Channel', i18nKey: 'apps.colChannel',
      render: (r) => t(`apps.channel.${r.channel_started}`) },
    { key: 'submitted_at', label: 'Submitted', i18nKey: 'apps.colSubmitted', numeric: true,
      render: (r) => fmtDateTime(r.submitted_at) },
  ], [navigate, programName, t]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="apps-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('apps.title')}
          <span className="page-subtitle">{rows.length} {t('common.records')}</span>
        </h1>
        <div className="page-header-actions">
          <div className="apps-view-toggle" role="group" aria-label={t('apps.viewToggle')}>
            <Button variant={view === 'table' ? 'primary' : 'secondary'} size="sm"
              aria-pressed={view === 'table'} onClick={() => setView('table')}>
              {t('apps.table')}
            </Button>
            <Button variant={view === 'board' ? 'primary' : 'secondary'} size="sm"
              aria-pressed={view === 'board'} onClick={() => setView('board')}>
              {t('apps.board')}
            </Button>
          </div>
          <Button variant="primary" onClick={() => navigate('/applications/new')}>
            {t('newApp.title')}
          </Button>
        </div>
      </header>

      <div className="apps-filters">
        <label htmlFor="apps-f-program">{t('apps.filterProgram')}</label>
        <select id="apps-f-program" value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}>
          <option value="">{t('apps.all')}</option>
          {programs.map((p) => (
            <option key={p.program_id} value={p.program_id}>{p.name}</option>
          ))}
        </select>
        <label htmlFor="apps-f-year">{t('apps.filterYear')}</label>
        <select id="apps-f-year" value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">{t('apps.all')}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <label htmlFor="apps-f-status">{t('apps.filterStatus')}</label>
        <select id="apps-f-status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('apps.all')}</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
      </div>

      {error && (
        <div className="programs-error" role="alert">
          <span>{t('apps.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {view === 'table' ? (
        <DataTable<ApplicationRow>
          columns={columns}
          data={pageRows}
          total={rows.length}
          page={page}
          pageSize={PAGE_SIZE}
          loading={loading}
          onPageChange={setPage}
          rowKey={(r) => r.application_id}
          selectable={false}
          onRowClick={(r) => navigate(`/applications/${r.application_id}`)}
          caption={t('apps.title')}
          emptyState={{
            title: t('apps.empty'),
            action: (
              <Button variant="primary" onClick={() => navigate('/applications/new')}>
                {t('newApp.title')}
              </Button>
            ),
          }}
        />
      ) : (
        <div className="apps-board">
          {STATUS_ORDER.map((s) => {
            const colRows = rows.filter((r) => r.status === s);
            return (
              <div key={s} className="apps-column">
                <h2>
                  {t(`status.${s}`)} <span>{countsByStatus.get(s) ?? 0}</span>
                </h2>
                {colRows.length === 0 ? (
                  <p className="apps-column-empty">{t('apps.columnEmpty')}</p>
                ) : colRows.map((r) => (
                  <button key={r.application_id} type="button" className="apps-card"
                    onClick={() => navigate(`/applications/${r.application_id}`)}>
                    <strong>{r.application_id}</strong>
                    <small>{programName(r.program_id)} · {r.school_year}</small>
                    <small>{r.applicant_email || t(`apps.channel.${r.channel_started}`)}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ApplicationsPage.css`:**

```css
/* enrollx/frontend/src/pages/ApplicationsPage.css */
.apps-page { padding: 20px; }
.apps-view-toggle { display: inline-flex; gap: 4px; }
.apps-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 16px; }
.apps-filters label { font-size: 13px; color: var(--text-secondary); }
.apps-filters select { border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary);
  font: inherit; font-size: 14px; padding: 6px 8px; }
.apps-filters select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.apps-link { border: 0; background: none; padding: 0; font: inherit;
  color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
.apps-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.apps-board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px;
  align-items: flex-start; }
.apps-column { flex: 0 0 240px; background: var(--bg-tertiary);
  border-radius: var(--radius-md); padding: 10px; }
.apps-column h2 { margin: 0 0 8px; font-size: 13px; color: var(--text-secondary);
  display: flex; justify-content: space-between; }
.apps-column h2 span { color: var(--text-tertiary); }
.apps-column-empty { color: var(--text-tertiary); font-size: 13px; margin: 4px 0; }
.apps-card { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; text-align: left; background: var(--bg-card);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  padding: 8px 10px; margin-bottom: 6px; font: inherit; cursor: pointer; }
.apps-card:hover { border-color: var(--accent); }
.apps-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.apps-card strong { color: var(--text-primary); font-size: 13px; }
.apps-card small { color: var(--text-secondary); font-size: 12px; }
```

- [ ] **Step 3: i18n keys** (both locales):

en-US:
```ts
    'apps.title': 'Applications',
    'apps.viewToggle': 'View',
    'apps.table': 'Table',
    'apps.board': 'Board',
    'apps.filterProgram': 'Program',
    'apps.filterYear': 'School year',
    'apps.filterStatus': 'Status',
    'apps.all': 'All',
    'apps.colId': 'Application',
    'apps.colProgram': 'Program',
    'apps.colYear': 'School year',
    'apps.colStatus': 'Status',
    'apps.colChannel': 'Channel',
    'apps.colSubmitted': 'Submitted',
    'apps.channel.parent': 'Parent',
    'apps.channel.admin': 'Staff',
    'apps.empty': 'No applications match.',
    'apps.columnEmpty': 'None',
    'apps.loadError': 'Could not load applications.',
```

zh-CN:
```ts
    'apps.title': '报名申请',
    'apps.viewToggle': '视图',
    'apps.table': '表格',
    'apps.board': '看板',
    'apps.filterProgram': '项目',
    'apps.filterYear': '学年',
    'apps.filterStatus': '状态',
    'apps.all': '全部',
    'apps.colId': '申请编号',
    'apps.colProgram': '项目',
    'apps.colYear': '学年',
    'apps.colStatus': '状态',
    'apps.colChannel': '渠道',
    'apps.colSubmitted': '提交时间',
    'apps.channel.parent': '家长',
    'apps.channel.admin': '员工',
    'apps.empty': '没有符合条件的申请。',
    'apps.columnEmpty': '暂无',
    'apps.loadError': '无法加载申请列表。',
```

- [ ] **Step 4: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): applications pipeline — table and kanban with filters and counts"
```

---

### Task 10: ApplicationDetailPage — checklist, lifecycle actions, timeline, documents, payments

Server-side transition guards return 409 with the allowed transitions (spec §11); the UI offers actions by status map and surfaces any 409 via toast — never bypass the guard.

**Files:**
- Replace stub: `enrollx/frontend/src/pages/ApplicationDetailPage.tsx`
- Create: `enrollx/frontend/src/pages/ApplicationDetailPage.css`
- Modify: `enrollx/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: actions `verify_item, reject_item, waive_item, approve, decline, request_changes, promote_waitlist, resend_link` (CONTRACT-2), `getDocumentUrl`, the SQL below.
- Produces: the spec §10 application-detail view; the "Continue entry" hand-off to Task 8.

The exact SQL (one query per section; `<id>` = the route's applicationId through `escapeSql`; ordering is client-side):

```sql
SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' AND application_id = '<id>'
SELECT * FROM data WHERE entity_type = 'application_item' AND _status = 'active' AND application_id = '<id>'
SELECT * FROM data WHERE entity_type = 'application_activity' AND _status = 'active' AND application_id = '<id>'
SELECT * FROM data WHERE entity_type = 'document' AND _status = 'active' AND application_id = '<id>'
SELECT * FROM data WHERE entity_type = 'payment' AND _status = 'active' AND application_id = '<id>'
```

- [ ] **Step 1: Replace `ApplicationDetailPage.tsx`:**

```tsx
// enrollx/frontend/src/pages/ApplicationDetailPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ApplicationStatus } from '@neoapex/flow-runtime';
import { formatCents } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { escapeSql, postQuery } from '../api/client.ts';
import { getDocumentUrl, postApplicationAction } from '../api/registration.ts';
import type {
  ActivityRow, ApplicationRow, DocumentRow, ItemRow, PaymentRow,
} from '../types/registration.ts';
import { fmtDateTime, toBoolish } from '../utils/format.ts';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationDetailPage.css';

const DECIDABLE: ApplicationStatus[] = ['submitted', 'in_review', 'pending_items'];

type Confirm =
  | { kind: 'approve' | 'decline' | 'request_changes' | 'promote_waitlist' }
  | { kind: 'reject_item'; itemId: string; title: string }
  | null;

export default function ApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();

  const [app, setApp] = useState<ApplicationRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = (type: string) => postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = '${type}' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
      const ar = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE entity_type = 'registration_application' AND _status = 'active' AND application_id = '${escapeSql(applicationId)}'`);
      setApp((ar.data[0] as unknown as ApplicationRow) ?? null);
      const [ir, acr, dr, pr] = await Promise.all([
        q('application_item'), q('application_activity'), q('document'), q('payment'),
      ]);
      setItems(ir.data as unknown as ItemRow[]);
      setActivities((acr.data as unknown as ActivityRow[])
        .sort((a, b) => String(b.at).localeCompare(String(a.at))));
      setDocuments(dr.data as unknown as DocumentRow[]);
      setPayments(pr.data as unknown as PaymentRow[]);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [tenant, applicationId]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (action: string, params: Record<string, unknown>, doneKey: string) => {
    setBusy(true);
    try {
      await postApplicationAction(tenant, applicationId, action, params);
      toast({ message: t(doneKey), tone: 'success' });
      setConfirm(null);
      setRejectReason('');
      await load();
    } catch (e) {
      // 409 carries the allowed transitions in the response body (spec §11).
      toast({ message: t('detail.actionError'), detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="detail-page"><div className="programs-error" role="alert">{error}</div></div>;
  if (!app) return <div className="detail-page"><p className="programs-muted">{t('common.loading')}</p></div>;

  const status = app.status;
  const itemActionsFor = (i: ItemRow) => {
    const acts: { key: 'verify_item' | 'reject_item' | 'waive_item'; label: string }[] = [];
    if (i.status === 'submitted') {
      acts.push({ key: 'verify_item', label: t('detail.verify') });
      acts.push({ key: 'reject_item', label: t('detail.reject') });
    }
    if (i.status !== 'waived' && i.status !== 'verified') {
      acts.push({ key: 'waive_item', label: t('detail.waive') });
    }
    return acts;
  };

  return (
    <div className="detail-page">
      <header className="page-header">
        <h1 className="page-title">
          {app.application_id}
          <span className="page-subtitle">
            {app.program_id} · {app.school_year} · {t(`apps.channel.${app.channel_started}`)}
            {app.applicant_email ? ` · ${app.applicant_email}` : ''}
          </span>
        </h1>
        <div className="page-header-actions">
          <StatusBadge status={status} label={t(`status.${status}`)} />
          <Button variant="secondary"
            onClick={() => navigate(`/applications/${applicationId}/enter`)}>
            {t('detail.continueEntry')}
          </Button>
          {app.applicant_email && (
            <Button variant="secondary" disabled={busy}
              onClick={() => void runAction('resend_link', {}, 'detail.linkSent')}>
              {t('detail.resendLink')}
            </Button>
          )}
        </div>
      </header>

      <div className="detail-actions">
        {DECIDABLE.includes(status) && (
          <>
            <Button variant="primary" disabled={busy}
              onClick={() => setConfirm({ kind: 'approve' })}>{t('detail.approve')}</Button>
            <Button variant="secondary" disabled={busy}
              onClick={() => setConfirm({ kind: 'request_changes' })}>{t('detail.requestChanges')}</Button>
            <Button variant="danger" disabled={busy}
              onClick={() => setConfirm({ kind: 'decline' })}>{t('detail.decline')}</Button>
          </>
        )}
        {status === 'waitlisted' && (
          <Button variant="primary" disabled={busy}
            onClick={() => setConfirm({ kind: 'promote_waitlist' })}>{t('detail.promote')}</Button>
        )}
      </div>

      <div className="detail-grid">
        <section className="detail-card" aria-label={t('detail.checklist')}>
          <h2>{t('detail.checklist')}</h2>
          <ul className="detail-items">
            {items.map((i) => (
              <li key={i.item_id} className="detail-item">
                <div className="detail-item-info">
                  <strong>{i.title}</strong>
                  <small>
                    {t(`detail.kind.${i.kind}`)}
                    {toBoolish(i.blocking) ? '' : ` · ${t('detail.nonBlocking')}`}
                    {i.completed_by ? ` · ${t('detail.completedBy')} ${i.completed_by}` : ''}
                    {i.due_at ? ` · ${t('detail.due')} ${fmtDateTime(i.due_at)}` : ''}
                  </small>
                </div>
                <StatusBadge status={i.status} label={t(`itemStatus.${i.status}`)} />
                <div className="detail-item-actions">
                  {itemActionsFor(i).map((a) => (
                    <Button key={a.key} variant="ghost" size="sm" disabled={busy}
                      onClick={() => a.key === 'reject_item'
                        ? setConfirm({ kind: 'reject_item', itemId: i.item_id, title: i.title })
                        : void runAction(a.key, { item_id: i.item_id }, 'detail.actionDone')}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
            {items.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.documents')}>
          <h2>{t('detail.documents')}</h2>
          <ul className="detail-rows">
            {documents.map((d) => (
              <li key={d.document_id}>
                <span className="detail-row-main">
                  {d.filename}
                  {toBoolish(d.sensitive) && (
                    <span className="detail-flag">{t('detail.sensitive')}</span>
                  )}
                </span>
                <small>{fmtDateTime(d.uploaded_at)} · {d.uploaded_by}</small>
                <Button variant="link" size="sm"
                  onClick={() => {
                    getDocumentUrl(tenant, d.document_id)
                      .then((r) => window.open(r.download_url, '_blank', 'noopener'))
                      .catch((e) => toast({ message: t('detail.downloadError'), detail: String(e), tone: 'danger' }));
                  }}>
                  {t('detail.download')}
                </Button>
              </li>
            ))}
            {documents.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.payments')}>
          <h2>{t('detail.payments')}</h2>
          <ul className="detail-rows">
            {payments.map((p) => (
              <li key={p.payment_id}>
                <span className="detail-row-main">
                  {formatCents(Number(p.amount))} · {p.kind} · {p.provider}
                </span>
                <small>{p.paid_at ? fmtDateTime(p.paid_at) : '—'}{p.recorded_by ? ` · ${p.recorded_by}` : ''}</small>
                <StatusBadge status={p.status} />
              </li>
            ))}
            {payments.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ul>
        </section>

        <section className="detail-card" aria-label={t('detail.timeline')}>
          <h2>{t('detail.timeline')}</h2>
          <ol className="detail-timeline">
            {activities.map((a) => (
              <li key={a.activity_id}>
                <span className="detail-row-main">
                  {t(`detail.activity.${a.type}`)}
                  {a.from_value || a.to_value ? `: ${a.from_value ?? '—'} → ${a.to_value ?? '—'}` : ''}
                </span>
                <small>{fmtDateTime(a.at)} · {a.actor}</small>
              </li>
            ))}
            {activities.length === 0 && <li className="programs-muted">{t('common.noResults')}</li>}
          </ol>
        </section>
      </div>

      <Modal open={confirm != null} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'reject_item'
          ? `${t('detail.rejectTitle')}: ${confirm.title}`
          : t(`detail.confirm.${confirm?.kind ?? 'approve'}`)}
        size="sm" dismissOnEscape={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirm?.kind === 'decline' || confirm?.kind === 'reject_item' ? 'danger' : 'primary'}
              loading={busy} loadingText={t('common.loading')}
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === 'reject_item') {
                  void runAction('reject_item',
                    { item_id: confirm.itemId, ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}) },
                    'detail.actionDone');
                } else {
                  void runAction(confirm.kind, {}, 'detail.actionDone');
                }
              }}>
              {t('detail.confirmGo')}
            </Button>
          </>
        }>
        {confirm?.kind === 'reject_item' ? (
          <div className="bcp-row bcp-row--stack">
            <label htmlFor="detail-reject-reason">{t('detail.rejectReason')}</label>
            <textarea id="detail-reject-reason" rows={3} value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)} />
          </div>
        ) : (
          <p>{t('detail.confirmBody')}</p>
        )}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Create `ApplicationDetailPage.css`:**

```css
/* enrollx/frontend/src/pages/ApplicationDetailPage.css */
.detail-page { padding: 20px; }
.detail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 16px; align-items: start; }
.detail-card { background: var(--bg-card); border: 1px solid var(--border-primary);
  border-radius: var(--radius-md); padding: 16px; }
.detail-card h2 { margin: 0 0 12px; font-size: 14px; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.04em; }
.detail-items, .detail-rows, .detail-timeline { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 10px; }
.detail-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 8px 10px; }
.detail-item-info { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; }
.detail-item-info strong { font-size: 14px; color: var(--text-primary); }
.detail-item-info small, .detail-rows small, .detail-timeline small {
  font-size: 12px; color: var(--text-tertiary); }
.detail-item-actions { display: flex; gap: 4px; }
.detail-rows li, .detail-timeline li { display: flex; flex-direction: column; gap: 2px;
  border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; }
.detail-row-main { font-size: 14px; color: var(--text-primary);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-flag { font-size: 11px; padding: 1px 6px; border-radius: 999px;
  background: var(--danger-muted); color: var(--danger); }
```

- [ ] **Step 3: i18n keys** (both locales):

en-US:
```ts
    'detail.checklist': 'Requirements',
    'detail.documents': 'Documents',
    'detail.payments': 'Payments',
    'detail.timeline': 'Activity',
    'detail.kind.form': 'Form',
    'detail.kind.document': 'Document',
    'detail.kind.esign': 'E-sign',
    'detail.kind.payment': 'Payment',
    'detail.nonBlocking': 'due after approval',
    'detail.completedBy': 'by',
    'detail.due': 'due',
    'detail.verify': 'Verify',
    'detail.reject': 'Reject',
    'detail.waive': 'Waive',
    'detail.approve': 'Approve',
    'detail.decline': 'Decline',
    'detail.requestChanges': 'Request changes',
    'detail.promote': 'Promote from waitlist',
    'detail.resendLink': 'Resend parent link',
    'detail.continueEntry': 'Continue entry',
    'detail.rejectTitle': 'Reject item',
    'detail.rejectReason': 'Reason (sent to the family)',
    'detail.confirm.approve': 'Approve this application?',
    'detail.confirm.decline': 'Decline this application?',
    'detail.confirm.request_changes': 'Request changes?',
    'detail.confirm.promote_waitlist': 'Promote from the waitlist?',
    'detail.confirmBody': 'This action is recorded in the activity log and may notify the family.',
    'detail.confirmGo': 'Confirm',
    'detail.actionDone': 'Done.',
    'detail.actionError': 'Action failed.',
    'detail.linkSent': 'Parent link sent.',
    'detail.download': 'Download',
    'detail.downloadError': 'Could not get the download link.',
    'detail.sensitive': 'Sensitive',
    'detail.activity.status_change': 'Status change',
    'detail.activity.item_change': 'Item change',
    'detail.activity.note': 'Note',
    'detail.activity.email_sent': 'Email sent',
```

zh-CN:
```ts
    'detail.checklist': '申请材料',
    'detail.documents': '文件',
    'detail.payments': '付款记录',
    'detail.timeline': '操作记录',
    'detail.kind.form': '表单',
    'detail.kind.document': '文件',
    'detail.kind.esign': '电子签名',
    'detail.kind.payment': '付款',
    'detail.nonBlocking': '录取后提交',
    'detail.completedBy': '完成人',
    'detail.due': '截止',
    'detail.verify': '核验',
    'detail.reject': '退回',
    'detail.waive': '豁免',
    'detail.approve': '录取',
    'detail.decline': '拒绝',
    'detail.requestChanges': '要求修改',
    'detail.promote': '候补转正',
    'detail.resendLink': '重发家长链接',
    'detail.continueEntry': '继续录入',
    'detail.rejectTitle': '退回材料',
    'detail.rejectReason': '原因（将发送给家庭）',
    'detail.confirm.approve': '确认录取该申请？',
    'detail.confirm.decline': '确认拒绝该申请？',
    'detail.confirm.request_changes': '确认要求修改？',
    'detail.confirm.promote_waitlist': '确认候补转正？',
    'detail.confirmBody': '此操作将写入操作记录，并可能通知该家庭。',
    'detail.confirmGo': '确认',
    'detail.actionDone': '已完成。',
    'detail.actionError': '操作失败。',
    'detail.linkSent': '家长链接已发送。',
    'detail.download': '下载',
    'detail.downloadError': '无法获取下载链接。',
    'detail.sensitive': '敏感',
    'detail.activity.status_change': '状态变更',
    'detail.activity.item_change': '材料变更',
    'detail.activity.note': '备注',
    'detail.activity.email_sent': '已发送邮件',
```

- [ ] **Step 4: Build, lint, commit.**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
git add enrollx/frontend
git commit -m "feat(enrollx): application detail — checklist actions, timeline, documents, payments"
```

---

### Task 11: Full verification — builds, lints, manual smoke runbook

**Files:** none (fixes only, if verification fails).

**Interfaces:** none — this task proves Tasks 1–10 against the running stack.

- [ ] **Step 1: Static verification — all must pass with zero errors:**

```bash
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build && npm run lint
cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build   # must not regress
```

- [ ] **Step 2: i18n completeness check** — every `t('...')` key used by the new pages exists in BOTH locales (a missing key renders as the raw key string with no warning):

```bash
cd /Users/kennylee/Development/NeoApex/enrollx/frontend
# Every statically-referenced key must appear at least twice in translations.ts
# (once per locale). Dynamic keys (status.*, itemStatus.*, apps.channel.*,
# builder.blockType.*, detail.kind.*, detail.activity.*, detail.confirm.*) are
# checked by enum below.
for k in $(grep -rhoE "t\('[a-zA-Z0-9_.]+'\)" src/pages src/components \
           | sed "s/^t('//; s/')$//" | sort -u); do
  n=$(grep -cF "'$k':" src/i18n/translations.ts)
  if [ "$n" -lt 2 ]; then echo "MISSING OR SINGLE-LOCALE: $k ($n)"; fi
done
for k in status.draft status.submitted status.in_review status.pending_items \
         status.approved status.enrolled status.waitlisted status.declined status.withdrawn \
         itemStatus.not_started itemStatus.in_progress itemStatus.submitted \
         itemStatus.verified itemStatus.rejected itemStatus.waived \
         apps.channel.parent apps.channel.admin \
         builder.blockType.form builder.blockType.documents builder.blockType.payment_plan \
         builder.blockType.payment builder.blockType.message builder.blockType.review \
         detail.kind.form detail.kind.document detail.kind.esign detail.kind.payment \
         detail.activity.status_change detail.activity.item_change detail.activity.note \
         detail.activity.email_sent detail.confirm.approve detail.confirm.decline \
         detail.confirm.request_changes detail.confirm.promote_waitlist; do
  n=$(grep -cF "'$k':" src/i18n/translations.ts)
  if [ "$n" -lt 2 ]; then echo "MISSING ENUM KEY: $k ($n)"; fi
done
```

Expected: no `MISSING` lines. Any hit means a key is absent from one or both locales — add it to `translations.ts` in BOTH locale objects before proceeding.

- [ ] **Step 3: Boot the stack:**

```bash
source ~/.zshrc && ./start-services.sh
curl -s localhost:5910/api/health   # {"status":"ok","service":"enrollx-backend"}
curl -s localhost:5800/health || curl -s localhost:5800/api/health
```

R2/Stripe/Resend env vars may be absent in dev — the smoke path below only requires them where marked (skip those two checks if unset; everything else must work).

- [ ] **Step 4: Manual smoke runbook** (Chrome, http://localhost:5900; log in with the same dev DataCore credentials used for admindash on :5600):

1. **Nav.** After login, the top nav shows Programs and Applications (and Plan 3's Settings if present). Switch the language toggle (if the scaffold kept one) or set `localStorage['preferredLanguage']='zh-CN'` and reload — nav renders in Chinese; switch back.
2. **Builder.** Go to `/programs` → each program shows a "Design registration flow" button → click one. On `/programs/<id>/flow`: add a Form step (source: From entity model → student) — the preview pane immediately shows the student fields; add a Documents step and add doc "Immunization record" (sensitive ✓, blocking ✓) — preview shows the doc row with an Upload button (disabled, preview); add Payment plan (both plans, Full 500, Deposit 100) — preview radio shows "$500.00" / "$100.00"; add Payment; add Message with two lines of text; move Message to the top with ↑ — preview reorders; the Review step stays pinned last. Click **Save draft** → toast "Draft saved."; click **Publish** → confirm modal → toast "Flow published."; reload the page → subtitle shows Version 1 · Published.
3. **Staff entry.** `/applications/new` → pick the program, keep the school year, enter your email → Create application → toast, and you land on `/applications/RA…/enter`. The step rail shows Message → Form → Documents → Payment plan → Payment → Review & submit. Fill the form leaving a required field empty → Save & continue shows the field error inline; fill it → Save & continue advances and the step gets a ✓. Upload a small PDF for "Immunization record" (requires DataCore R2 env; if unset, expect the upload-failed toast and skip) → status pill flips to Submitted. Choose Deposit → Payment step shows "$100.00" with **Pay** and **Record offline payment**. Click Record offline payment → modal → amount 100 → confirm → toast, payment step shows Paid. Review step: all rows ✓ (doc row too, or waive it later) → **Submit application** → toast → redirected to the detail page.
4. **Pipeline.** `/applications`: the row appears with status Submitted; switch to **Board** → the card sits in the Submitted column with count 1; set the Program filter to another program → the card disappears; reset filters.
5. **Detail.** Open the application: the checklist shows each item with status; click **Verify** on the document item → badge flips to Verified and a new Activity entry appears; payments card lists the $100.00 offline payment with recorded_by; documents card shows the file — **Download** opens the presigned URL (R2 env required); click **Approve** → confirm → status badge flips to Approved (and later Enrolled once post-approval items verify, per the Plan 2 engine). **Resend parent link** shows a success toast (requires Resend env; if unset expect the error toast — acceptable in dev).
6. **Guard check.** On an Approved application, the Approve/Decline buttons are gone; if you force an illegal action (e.g. re-submit via the entry page), the server's 409 surfaces as an "Action failed." toast — the app must not crash.

- [ ] **Step 5: Kill services, final commit, report.**

```bash
# stop whatever start-services.sh launched (per its own instructions), then:
cd /Users/kennylee/Development/NeoApex && git status   # expect clean or only intended changes
git add -A && git commit -m "chore(enrollx): plan 4 verification fixes" # only if fixes were needed
git log --oneline main..HEAD
```

Report completion with the commit list, the CONTRACT-1..5 findings from Task 0, and any smoke steps skipped for missing env (R2/Stripe/Resend).
