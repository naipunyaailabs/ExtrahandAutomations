from app.services import ivr
from tests.factories import make_attempt, make_ticket


def test_simulator_wrong_key_replays_the_prompt_after_the_error_line(client, db):
    attempt = make_attempt(db, make_ticket(db), "dispatch", status="ringing")
    db.commit()
    url = f"/api/simulator/calls/{attempt.id}"
    assert client.post(url, json={"action": "answer"}).status_code == 200
    spoken = client.post(url, json={"action": "press", "digit": "7"}).json()["spoken"]
    assert ivr.INVALID_KEY in spoken and ivr.REPEAT_PREFIX in spoken and "Kondapur" in spoken
