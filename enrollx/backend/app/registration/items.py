"""Derive application_item field sets from a registration_config's blocks,
and validate block JSON at publish time.

Both functions operate on the PARSED block list (`list[dict]`), i.e. the
Python-side representation of the TypeScript `FlowBlock[]` shape defined in
`flow-runtime/src/types.ts`. Callers are responsible for parsing the JSON
string stored on `registration_config.blocks` before calling either
function here — this module never touches the JSON-string encoding itself.

Derivation (roadmap contract): form -> 1 form item; documents -> 1 item per
doc; payment_plan -> NO item (choice stored at draft_data.payment_plan_selection);
payment -> 1 payment item; message/review -> none.

Money (amounts inside payment_plan config, e.g. amount_full/deposit_amount)
is validated as integer cents — no float arithmetic anywhere in this module.
"""
from app.registration.statuses import ITEM_STATUSES

NOT_STARTED = ITEM_STATUSES[0]
assert NOT_STARTED == "not_started"

ALLOWED_BLOCK_TYPES = {"form", "documents", "payment_plan", "payment", "message", "review"}
PLAN_TYPES = {"pay_in_full", "deposit"}

# The entity models a `form` block may draw from (spec §4).
# `registration_application` is the tenant's own application model; its
# answers are written onto the application entity rather than staged in
# draft_data (actions._apply_application_fields). Mirrored in the builder's
# BlockConfigPanel ENTITY_TYPES.
FORM_ENTITY_TYPES = {"student", "family", "contact", "registration_application"}


def _item(block, kind, title, blocking, due_days):
    fields = {
        "block_id": block["block_id"],
        "kind": kind,
        "title": title,
        "status": NOT_STARTED,
        "blocking": bool(blocking),
    }
    if due_days is not None:
        fields["due_days_after_approval"] = int(due_days)
    return fields


def derive_items(blocks: list[dict]) -> list[dict]:
    """Derive application_item field dicts from a program's parsed blocks.

    Returns dicts WITHOUT `item_id`/`application_id` — the engine that calls
    this (a later task) is responsible for adding those before persisting.
    """
    items = []
    for block in blocks:
        btype = block.get("type")
        if btype == "form":
            items.append(_item(block, "form", block.get("title", "Form"),
                               block.get("blocking", True),
                               block.get("due_days_after_approval")))
        elif btype == "documents":
            for i, doc in enumerate(block.get("config", {}).get("docs", [])):
                items.append(_item(
                    block, "document",
                    doc.get("name", f"Document {i + 1}"),
                    doc.get("blocking", block.get("blocking", True)),
                    doc.get("due_days_after_approval", block.get("due_days_after_approval")),
                ))
        elif btype == "payment":
            items.append(_item(block, "payment", block.get("title", "Payment"),
                               block.get("blocking", True),
                               block.get("due_days_after_approval")))
        # payment_plan / message / review produce no items
    return items


def validate_blocks(blocks) -> list[str]:
    """Validate a parsed block list against the full `FlowBlock` shape contract
    (`flow-runtime/src/types.ts`) at publish time. Empty list = valid.

    Enforces SHAPE only: block_id/type/title/required/blocking/config presence
    and type, plus the type-specific config checks already carried over from
    the original implementation (documents/payment_plan/review-last). Does not
    validate config payloads beyond that — deeper per-block-type config rules
    are a later task's concern.
    """
    if not isinstance(blocks, list) or not blocks:
        return ["blocks must be a non-empty array"]
    errors: list[str] = []
    seen: set[str] = set()
    for i, b in enumerate(blocks):
        where = f"blocks[{i}]"
        if not isinstance(b, dict):
            errors.append(f"{where}: must be an object")
            continue
        bid = b.get("block_id")
        if isinstance(bid, str) and bid:
            where = f"blocks[{i}] (block_id={bid!r})"
        if not bid or not isinstance(bid, str):
            errors.append(f"{where}: block_id is required")
        elif bid in seen:
            errors.append(f"{where}: duplicate block_id '{bid}'")
        else:
            seen.add(bid)
        btype = b.get("type")
        if btype not in ALLOWED_BLOCK_TYPES:
            errors.append(f"{where}: type must be one of {sorted(ALLOWED_BLOCK_TYPES)}")
        title = b.get("title")
        if not isinstance(title, str) or not title:
            errors.append(f"{where}: title is required")
        if "required" not in b or not isinstance(b.get("required"), bool):
            errors.append(f"{where}: 'required' must be a bool")
        if "blocking" not in b or not isinstance(b.get("blocking"), bool):
            errors.append(f"{where}: 'blocking' must be a bool")
        if "due_days_after_approval" in b:
            ddaa = b.get("due_days_after_approval")
            if not isinstance(ddaa, int) or isinstance(ddaa, bool):
                errors.append(f"{where}: due_days_after_approval must be an integer")
        cfg = b.get("config")
        if "config" not in b or not isinstance(cfg, dict):
            errors.append(f"{where}: 'config' must be an object")
        cfg = cfg if isinstance(cfg, dict) else {}
        if btype == "form":
            et = cfg.get("entity_type")
            if et is not None and et not in FORM_ENTITY_TYPES:
                errors.append(
                    f"{where}: config.entity_type must be one of "
                    f"{sorted(FORM_ENTITY_TYPES)}")
        if btype == "documents":
            docs = cfg.get("docs")
            if not isinstance(docs, list) or not docs:
                errors.append(f"{where}: documents block needs config.docs (non-empty array)")
            else:
                for j, d in enumerate(docs):
                    if not isinstance(d, dict) or not d.get("name"):
                        errors.append(f"{where}.docs[{j}]: name is required")
        if btype == "payment_plan":
            plans = cfg.get("plans")
            if not isinstance(plans, list) or not plans:
                errors.append(f"{where}: payment_plan block needs config.plans (non-empty array)")
            else:
                # amount_full is TOP-LEVEL config (integer cents);
                # deposit_amount lives on the deposit plan object (integer cents).
                if not isinstance(cfg.get("amount_full"), int):
                    errors.append(f"{where}: config.amount_full (integer cents) is required")
                for j, p in enumerate(plans):
                    pw = f"{where}.plans[{j}]"
                    if not isinstance(p, dict) or p.get("type") not in PLAN_TYPES:
                        errors.append(f"{pw}: type must be one of {sorted(PLAN_TYPES)}")
                        continue
                    if p["type"] == "deposit" and not isinstance(p.get("deposit_amount"), int):
                        errors.append(f"{pw}: deposit_amount (integer cents) is required")
        if btype == "review" and i != len(blocks) - 1:
            errors.append(f"{where}: review block must be last")
    return errors
