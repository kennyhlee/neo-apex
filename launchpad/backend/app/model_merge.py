"""LaunchPad owns base_model.json, so it owns the rule for folding base fields
into a tenant's model. The dev reseed script (scripts/apexflow-reseed-dev.py)
imports this. Papermite's finalize has its own variant and is unrelated.
"""


def merge_model_definition(base_fields: list[dict], existing: list[dict]) -> dict:
    """`base_fields` (always win) + whatever of `existing` isn't itself a
    base field, deduped by name, first-write-wins.

    The exact merge rule scripts/reset_registration_dev_data.py established
    for spec §4 rule 1 (Papermite finalize's "merge, never replace"),
    generalized here to every entity type in base_model.json rather than
    just the two registration ones. Pure function: no I/O, does not mutate
    either input.

    A carried-forward field that is `required: True` with no `default` is
    demoted to optional. Discovered live (Task 13 gate, tenant "acme"):
    registration_application's PRIOR schema generation had `config_version`
    and `channel_started` as required base fields (options ["parent",
    "admin"]); apexflow's current base_model.json dropped them from
    registration_application (that concept now lives on workflow_instance,
    options ["family", "staff"]) so they fall into `existing` here as
    ordinary carried-forward fields. No template section can ever satisfy a
    field the current base schema no longer declares, so keeping
    `required: True` makes app.workflows.validate.validate_definition's
    unconditional-coverage check fail on every publish, permanently, for any
    tenant that ever had the old schema. A field with a `default` is left
    alone -- validate_definition's coverage check already exempts those
    (`"default" in fdef`) regardless of `required`, so it self-satisfies and
    isn't the hazard this guards against.
    """
    base_names = {f["name"] for f in base_fields}
    custom: list[dict] = []
    seen: set[str] = set()
    for f in existing:
        name = f.get("name")
        if not name or name in base_names or name in seen:
            continue
        if f.get("required") and "default" not in f:
            f = {**f, "required": False}
        custom.append(f)
        seen.add(name)
    return {"base_fields": base_fields, "custom_fields": custom}
