"""Item derivation from config blocks + publish-time block validation."""
from app.registration.items import derive_items, validate_blocks
from tests.fakes import BLOCKS


def test_derive_items_counts_and_kinds():
    items = derive_items(BLOCKS)
    assert [i["kind"] for i in items] == ["form", "document", "document", "payment"]
    assert all(i["status"] == "not_started" for i in items)
    assert all("item_id" not in i and "application_id" not in i for i in items)


def test_document_items_carry_doc_level_flags():
    items = derive_items(BLOCKS)
    report_card = next(i for i in items if i["title"] == "Report Card")
    assert report_card["blocking"] is False
    assert report_card["due_days_after_approval"] == 14
    immun = next(i for i in items if i["title"] == "Immunization Record")
    assert immun["blocking"] is True
    assert "due_days_after_approval" not in immun


def test_non_item_blocks_produce_nothing():
    items = derive_items(BLOCKS)
    assert {i["block_id"] for i in items} == {"b1", "b2", "b4"}  # no b3/b5/b6


def test_validate_blocks_accepts_the_fixture():
    assert validate_blocks(BLOCKS) == []


def test_validate_blocks_reports_specific_errors():
    errs = validate_blocks([
        {"block_id": "b1", "type": "documents", "title": "Docs", "config": {}},
        {"block_id": "b1", "type": "mystery", "title": ""},
        {"block_id": "b2", "type": "payment_plan", "title": "Plan",
         "config": {"plans": [{"type": "deposit"}]}},
    ])
    joined = "\n".join(errs)
    assert "config.docs" in joined
    assert "duplicate block_id" in joined
    assert "type must be one of" in joined
    assert "title is required" in joined
    assert "deposit_amount" in joined


def test_validate_blocks_review_must_be_last():
    errs = validate_blocks([
        {"block_id": "r", "type": "review", "title": "Review"},
        {"block_id": "m", "type": "message", "title": "Msg", "config": {"body": "x"}},
    ])
    assert any("review block must be last" in e for e in errs)


def test_validate_blocks_rejects_empty():
    assert validate_blocks([]) == ["blocks must be a non-empty array"]
