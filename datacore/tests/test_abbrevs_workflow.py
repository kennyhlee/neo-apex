"""Tests for workflow entity abbreviations in DEFAULT_ABBREVS.

ApexFlow Plan 1 Task 2: workflow_definition, workflow_instance,
workflow_item, workflow_activity are new entity types needing DataCore
auto-ID support. registration_config, application_item,
application_activity, and payment are retired (their entity types are
removed from base_model.json), so their abbrevs are dropped too.
registration_application survives (retained + enriched per spec §8).
"""

from datacore.api.routes import DEFAULT_ABBREVS


def test_workflow_abbrevs_present():
    assert DEFAULT_ABBREVS["workflow_definition"] == "WD"
    assert DEFAULT_ABBREVS["workflow_instance"] == "WI"
    assert DEFAULT_ABBREVS["workflow_item"] == "WT"
    assert DEFAULT_ABBREVS["workflow_activity"] == "WA"


def test_registration_application_abbrev_retained():
    assert DEFAULT_ABBREVS["registration_application"] == "RA"


def test_retired_entity_abbrevs_removed():
    assert "registration_config" not in DEFAULT_ABBREVS
    assert "application_item" not in DEFAULT_ABBREVS
    assert "application_activity" not in DEFAULT_ABBREVS
    assert "payment" not in DEFAULT_ABBREVS
