import pytest

pytest.importorskip("livekit.agents")


def test_the_agent_module_imports_and_names_its_worker():
    import agent
    import config

    assert config.AGENT_NAME == "extrahand-ivr-handoff" and callable(agent.entrypoint)
