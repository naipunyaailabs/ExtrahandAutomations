import pytest

import results

CATEGORIES = ["late_arrival", "poor_service", "incomplete_work", "overcharging", "rude_behavior", "other"]


def test_running_late_requires_eta():
    for bad in (None, 0, 601, -5):
        with pytest.raises(ValueError):
            results.reminder_body("running_late", "Traffic", bad)
    body = results.reminder_body("running_late", "Traffic", 45)
    assert body["kind"] == "reminder" and body["decision"] == "running_late"
    assert body["eta_minutes"] == 45 and body["reason"] == "Traffic" and "45" in body["summary"]


def test_cannot_come_needs_no_eta_and_ignores_one():
    body = results.reminder_body("cannot_come", "Fever", 30)
    assert body["decision"] == "cannot_come" and "eta_minutes" not in body and "Fever" in body["summary"]


def test_an_unknown_decision_is_refused():
    with pytest.raises(ValueError):
        results.reminder_body("maybe", "x", 10)


@pytest.mark.parametrize("category", CATEGORIES)
def test_known_rating_categories_are_accepted(category):
    body = results.rating_body(category, "Came late")
    assert body["kind"] == "rating" and body["complaint_category"] == category and body["details"] == "Came late"


def test_rating_category_must_be_known():
    with pytest.raises(ValueError):
        results.rating_body("weather", "Rainy")


def test_text_is_trimmed_to_the_backends_limits():
    body = results.reminder_body("cannot_come", "r" * 900, None, summary="s" * 2000)
    assert len(body["reason"]) == 500 and len(body["summary"]) == 1000
    rated = results.rating_body("other", "d" * 2000, summary="s" * 2000)
    assert len(rated["details"]) == 1000 and len(rated["summary"]) == 1000


def test_the_models_own_summary_is_kept_and_a_transcript_is_attached_when_given():
    body = results.reminder_body("cannot_come", "Fever", None, summary="Helper is ill", transcript="Maya: why?")
    assert body["summary"] == "Helper is ill" and body["transcript"] == "Maya: why?"
    assert "transcript" not in results.reminder_body("cannot_come", "Fever", None)
