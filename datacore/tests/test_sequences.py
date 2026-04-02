"""Tests for sequences table: get_sequence, increment_sequence."""


def test_get_sequence_no_table(store):
    """Returns 0 when no sequences table exists."""
    result = store.get_sequence("t1", "student", "2026")
    assert result == 0


def test_get_sequence_no_matching_row(store):
    """Returns 0 when table exists but no matching row."""
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2027")
    assert result == 0


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
    assert result == 2


def test_sequences_independent_per_year(store):
    """Different years have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2027")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t1", "student", "2027") == 1


def test_sequences_independent_per_entity_type(store):
    """Different entity types have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "staff", "2026")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t1", "staff", "2026") == 1


def test_sequences_tenant_isolation(store):
    """Different tenants have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t2", "student", "2026") == 0
