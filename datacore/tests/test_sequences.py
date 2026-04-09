"""Tests for sequences table: get_sequence, increment_sequence."""


def test_get_sequence_no_table(store):
    """Returns defaults when no sequences table exists."""
    result = store.get_sequence("t1", "student", "2026")
    assert result == {"counter": 0, "entity_abbrev": ""}


def test_get_sequence_no_matching_row(store):
    """Returns defaults when table exists but no matching row."""
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2027")
    assert result == {"counter": 0, "entity_abbrev": ""}


def test_increment_sequence_first_call(store):
    """First increment returns 1."""
    result = store.increment_sequence("t1", "student", "2026")
    assert result == 1


def test_increment_sequence_subsequent(store):
    """Each call increments by 1."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    result = store.increment_sequence("t1", "student", "2026")
    assert result == 3


def test_get_sequence_after_increments(store):
    """get_sequence reflects the current counter."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2026")
    assert result["counter"] == 2


def test_sequences_independent_per_year(store):
    """Different years have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2027")

    assert store.get_sequence("t1", "student", "2026")["counter"] == 2
    assert store.get_sequence("t1", "student", "2027")["counter"] == 1


def test_sequences_independent_per_entity_type(store):
    """Different entity types have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "staff", "2026")

    assert store.get_sequence("t1", "student", "2026")["counter"] == 2
    assert store.get_sequence("t1", "staff", "2026")["counter"] == 1


def test_sequences_tenant_isolation(store):
    """Different tenants have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")

    assert store.get_sequence("t1", "student", "2026")["counter"] == 2
    assert store.get_sequence("t2", "student", "2026")["counter"] == 0


def test_entity_abbrev_stored_and_retrieved(store):
    """entity_abbrev is persisted with the sequence record."""
    store.increment_sequence("t1", "student", "2026", entity_abbrev="ST")
    result = store.get_sequence("t1", "student", "2026")
    assert result["entity_abbrev"] == "ST"
    assert result["counter"] == 1


def test_entity_abbrev_preserved_on_increment(store):
    """entity_abbrev is preserved across increments when not re-specified."""
    store.increment_sequence("t1", "student", "2026", entity_abbrev="ST")
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2026")
    assert result["entity_abbrev"] == "ST"
    assert result["counter"] == 2
