# apexflow/backend/app/templates/catalog.py
"""The shipped workflow-template catalog — the single list the designer's
template gallery reads (`app/api/designer.py`'s `GET .../templates`).

This module exists because the catalog stopped being one template's
business. It used to live on `app.templates.enrollment` as
`template_catalog()`, which was fine while enrollment was the only template
that existed; a second template would have had to either import the first or
be imported by it. Each template module now contributes exactly one
`catalog_entry()` and this module is the only place that knows how many
there are.

The catalog is platform-wide, not tenant data — nothing here reads from or
writes to DataCore. Order is the gallery's display order.
"""
from typing import Any

from app.templates import enrollment, signup


def template_catalog() -> list[dict[str, Any]]:
    """`[{template_id, name, description, definition: {machine, steps,
    channel_access}}]`, one entry per shipped template."""
    return [enrollment.catalog_entry(), signup.catalog_entry()]
