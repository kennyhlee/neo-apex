# apexflow/backend/tests/test_conditions.py
"""Table-driven tests for app/workflows/conditions.py — evaluate_condition,
the pure function that decides show_if / data_condition truth values against
collected draft data.

Written first per TDD. `evaluate_condition(group, data)` semantics (from
task-3-brief.md, exact):
- `data` keys are "{section_id}.{field}" and "context.{key}".
- missing source -> "empty" is True, "not_empty"/"truthy" are False,
  eq/ne/in evaluate against None (i.e. as if the missing value were None).
- Ops exactly: eq, ne, in, empty, not_empty, truthy.

Design decision (undocumented by the brief, flagged in the report): a `not`
group's list is evaluated the same shape as `any` (a list of items) and
negated as a whole — `not: [a, b]` is true iff none of `a, b` evaluate true
(NOR), keeping list-shaped semantics symmetric with `all`/`any` rather than
treating `not` as wrapping a single operand.
"""
import pytest

from app.workflows.conditions import evaluate_condition
from app.workflows.schema import Condition, ConditionGroup

# A representative data dict covering present values of every "shape" that
# matters for op semantics (string, empty string, zero, falsy-but-present,
# list, empty list, dict, empty dict, None-valued key present) plus keys
# that are deliberately absent (missing-source rows use a source that is
# simply not a key in this dict).
DATA = {
    "student.first_name": "Ada",
    "student.middle_name": "",
    "student.age": 0,
    "student.grade": "K",
    "context.school_year": "2026-2027",
    "context.tags": ["priority", "returning"],
    "context.empty_tags": [],
    "context.meta": {"k": "v"},
    "context.empty_meta": {},
    "context.explicit_none": None,
    "context.flag": True,
    "context.flag_false": False,
}

MISSING_SOURCE = "context.does_not_exist"


def _cond(source, op, value=None):
    return Condition(source=source, op=op, value=value)


# --- Full per-op truth table, present-source rows ---------------------------

PRESENT_CASES = [
    # eq
    ("student.first_name", "eq", "Ada", True),
    ("student.first_name", "eq", "Grace", False),
    ("student.age", "eq", 0, True),
    ("context.explicit_none", "eq", None, True),
    # ne
    ("student.first_name", "ne", "Ada", False),
    ("student.first_name", "ne", "Grace", True),
    ("context.explicit_none", "ne", None, False),
    # in
    ("student.grade", "in", ["K", "1", "2"], True),
    ("student.grade", "in", ["3", "4"], False),
    ("context.explicit_none", "in", ["K", None], True),
    # empty
    ("student.first_name", "empty", None, False),
    ("student.middle_name", "empty", None, True),  # empty string
    ("student.age", "empty", None, False),  # zero is not "empty"
    ("context.empty_tags", "empty", None, True),  # empty list
    ("context.tags", "empty", None, False),  # non-empty list
    ("context.empty_meta", "empty", None, True),  # empty dict
    ("context.meta", "empty", None, False),  # non-empty dict
    ("context.explicit_none", "empty", None, True),  # present-but-None
    # not_empty
    ("student.first_name", "not_empty", None, True),
    ("student.middle_name", "not_empty", None, False),
    ("student.age", "not_empty", None, True),
    ("context.empty_tags", "not_empty", None, False),
    ("context.tags", "not_empty", None, True),
    ("context.explicit_none", "not_empty", None, False),
    # truthy
    ("student.first_name", "truthy", None, True),
    ("student.middle_name", "truthy", None, False),
    ("student.age", "truthy", None, False),  # 0 is falsy
    ("context.flag", "truthy", None, True),
    ("context.flag_false", "truthy", None, False),  # explicit Python False
    ("context.empty_tags", "truthy", None, False),
    ("context.tags", "truthy", None, True),
    ("context.explicit_none", "truthy", None, False),
]


@pytest.mark.parametrize("source,op,value,expected", PRESENT_CASES)
def test_present_source_truth_table(source, op, value, expected):
    cond = _cond(source, op, value)
    assert evaluate_condition(ConditionGroup(all_=[cond]), DATA) is expected


# --- Missing-source rows, one per op ------------------------------------------

MISSING_CASES = [
    ("empty", None, True),
    ("not_empty", None, False),
    ("truthy", None, False),
    ("eq", None, True),   # None == None
    ("eq", "anything", False),
    ("ne", None, False),  # None != None is False
    ("ne", "anything", True),
    ("in", ["a", None, "b"], True),  # None in [...]
    ("in", ["a", "b"], False),
]


@pytest.mark.parametrize("op,value,expected", MISSING_CASES)
def test_missing_source_truth_table(op, value, expected):
    cond = _cond(MISSING_SOURCE, op, value)
    assert evaluate_condition(ConditionGroup(all_=[cond]), DATA) is expected


# --- Group aggregation: all / any / not, flat -----------------------------------

def test_all_true_when_every_item_true():
    group = ConditionGroup(all_=[
        _cond("student.first_name", "eq", "Ada"),
        _cond("context.school_year", "not_empty"),
    ])
    assert evaluate_condition(group, DATA) is True


def test_all_false_when_one_item_false():
    group = ConditionGroup(all_=[
        _cond("student.first_name", "eq", "Ada"),
        _cond("context.school_year", "eq", "1999-2000"),
    ])
    assert evaluate_condition(group, DATA) is False


def test_any_true_when_one_item_true():
    group = ConditionGroup(any_=[
        _cond("student.first_name", "eq", "Grace"),
        _cond("context.school_year", "not_empty"),
    ])
    assert evaluate_condition(group, DATA) is True


def test_any_false_when_all_items_false():
    group = ConditionGroup(any_=[
        _cond("student.first_name", "eq", "Grace"),
        _cond("context.school_year", "eq", "1999-2000"),
    ])
    assert evaluate_condition(group, DATA) is False


def test_not_true_when_all_items_false():
    group = ConditionGroup(not_=[
        _cond("student.first_name", "eq", "Grace"),
        _cond("context.school_year", "eq", "1999-2000"),
    ])
    assert evaluate_condition(group, DATA) is True


def test_not_false_when_any_item_true():
    group = ConditionGroup(not_=[
        _cond("student.first_name", "eq", "Ada"),
        _cond("context.school_year", "eq", "1999-2000"),
    ])
    assert evaluate_condition(group, DATA) is False


def test_all_with_empty_list_is_vacuously_true():
    assert evaluate_condition(ConditionGroup(all_=[]), DATA) is True


def test_any_with_empty_list_is_vacuously_false():
    assert evaluate_condition(ConditionGroup(any_=[]), DATA) is False


def test_not_with_empty_list_is_vacuously_true():
    assert evaluate_condition(ConditionGroup(not_=[]), DATA) is True


# --- Nesting: all-of-any, and-of-not -----------------------------------------

def test_nested_all_of_any_true():
    # all[ any[grade==K, grade==1], school_year not_empty ]
    group = ConditionGroup(all_=[
        ConditionGroup(any_=[
            _cond("student.grade", "eq", "K"),
            _cond("student.grade", "eq", "1"),
        ]),
        _cond("context.school_year", "not_empty"),
    ])
    assert evaluate_condition(group, DATA) is True


def test_nested_all_of_any_false_when_any_branch_fails():
    group = ConditionGroup(all_=[
        ConditionGroup(any_=[
            _cond("student.grade", "eq", "2"),
            _cond("student.grade", "eq", "3"),
        ]),
        _cond("context.school_year", "not_empty"),
    ])
    assert evaluate_condition(group, DATA) is False


def test_nested_any_of_not():
    # any[ not[grade == 2], eq false-branch ] -> true because not[grade==2] is true
    group = ConditionGroup(any_=[
        ConditionGroup(not_=[_cond("student.grade", "eq", "2")]),
        _cond("student.first_name", "eq", "Grace"),
    ])
    assert evaluate_condition(group, DATA) is True


def test_nested_from_json_parsed_group_round_trip_evaluation():
    # Parse a raw dict (as it would arrive over JSON) rather than
    # constructing via kwargs, to exercise alias parsing + recursion
    # together.
    raw = {
        "all": [
            {"any": [
                {"source": "student.grade", "op": "eq", "value": "K"},
                {"source": "student.grade", "op": "eq", "value": "1"},
            ]},
            {"not": [{"source": "context.school_year", "op": "empty"}]},
        ]
    }
    group = ConditionGroup.model_validate(raw)
    assert evaluate_condition(group, DATA) is True
