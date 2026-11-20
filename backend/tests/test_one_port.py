"""Backend and dashboard on one port: the built React app is served by the API server."""

import app.main as main


def test_dashboard_is_served_next_to_the_api(client, monkeypatch, tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "assets" / "app-123.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path.parent / "secret.txt").write_text("no", encoding="utf-8")
    monkeypatch.setattr(main, "frontend_dist", lambda: tmp_path)

    home = client.get("/")
    assert home.status_code == 200 and "id=root" in home.text and home.headers["cache-control"] == "no-cache"
    deep = client.get("/advertisement/task-seeding/calendar")  # a client-side route
    assert deep.status_code == 200 and "id=root" in deep.text
    js = client.get("/assets/app-123.js")
    assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
    assert "no" != client.get("/../secret.txt").text  # never outside the build folder
    assert client.get("/api/does-not-exist").status_code == 404  # unknown API paths stay errors
    assert client.get("/api/system/health").status_code != 200 or "id=root" not in client.get("/api/system/health").text


def test_clear_message_when_not_built(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "frontend_dist", lambda: tmp_path / "missing")
    r = client.get("/")
    assert r.status_code == 404 and "npm run build" in r.json()["detail"]
