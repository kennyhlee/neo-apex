## Why

School administrators need a way to capture prospective-family interest and shepherd it toward enrollment. Today AdminDash can manage families, students, and programs, but there is no place to track a prospect *before* they become a family — inquiries arrive by web form, phone, and email and are managed ad hoc. A lead module gives admins a single pipeline from first inquiry to enrolled (or lost), with a lightweight activity trail and a one-click hand-off into the existing Family/Student records.

## What Changes

- Add a **Lead** entity (tenant-scoped, persisted in DataCore like other AdminDash entities) with contact and interest fields plus a pipeline `stage`.
- **Lead intake** through three paths: a public web form (unauthenticated submission scoped to a tenant), authenticated manual entry inside AdminDash, and import from email (paste/forward an inquiry email → parse into lead fields for review before save).
- **Pipeline** with fixed ordered stages: `New → Contacted → Tour Scheduled → Toured → Enrolled/Lost`. Admins move a lead between stages; stage changes are recorded.
- **Activity log** per lead — a single `lead_activities` collection with a `type` enum (`call`, `email`, `note`, plus system-generated `stage_change`). Deliberately denormalized: one record shape for all activity types.
- **Convert to Family** action — from a lead, pre-fill and create a Family record and an initial Student record from the lead's data, then mark the lead `Enrolled` and link it to the created family.

## Capabilities

### New Capabilities
- `lead-intake`: Creating leads via public web form, authenticated manual entry, and email-paste import (parse-then-review).
- `lead-pipeline`: The lead entity, its ordered pipeline stages, listing/filtering by stage, and stage-transition rules.
- `lead-activity-log`: Recording and viewing per-lead activities (call/email/note) plus auto-logged stage changes, via a single denormalized activity collection.
- `lead-conversion`: Converting a lead into Family + Student records, pre-filling from lead data and linking back to the lead.

### Modified Capabilities
<!-- No existing AdminDash spec requirements change; Family/Student creation is reused, not redefined. -->

## Impact

- **AdminDash backend** (`admindash/backend`): new `leads` router (CRUD, stage transitions, activities, convert), Pydantic schemas, and DataCore proxy calls for the new `leads` / `lead_activities` collections. One route is **public** (web-form intake) — outside the normal JWT-required set — and needs a scoped, unauthenticated path.
- **AdminDash frontend** (`admindash/frontend`): new Leads pages (pipeline/list, lead detail with activity log, manual-entry & email-import forms, convert-to-family action), API client methods, routing + nav entry. A standalone public web-form page/route.
- **DataCore**: two new tenant-scoped collections (`leads`, `lead_activities`). Reuses existing Family/Student write paths for conversion — no change to their schemas.
- **Auth**: public intake endpoint is a new trust-boundary surface (unauthenticated write, tenant-scoped, needs abuse consideration — e.g. captcha/rate-limit noted as a follow-up).
