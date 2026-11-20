import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("livekit.api")

from livekit import api  # noqa: E402

import config  # noqa: E402
import setup_livekit  # noqa: E402


class FakeSip:
    """Stands in for LiveKitAPI.sip: remembers what exists and what was created."""

    def __init__(self, trunks=(), rules=()):
        self.trunks, self.rules, self.created = list(trunks), list(rules), []

    async def list_inbound_trunk(self, request):
        return SimpleNamespace(items=self.trunks)

    async def create_inbound_trunk(self, request):
        self.created.append("trunk")
        trunk = request.trunk
        trunk.sip_trunk_id = "ST_new"
        self.trunks.append(trunk)
        return trunk

    async def list_dispatch_rule(self, request):
        return SimpleNamespace(items=self.rules)

    async def create_dispatch_rule(self, request):
        self.created.append("rule")
        rule = request.dispatch_rule
        rule.sip_dispatch_rule_id = "SDR_new"
        self.rules.append(rule)
        return rule


ADDRESSES = ["203.0.113.0/27"]


def _ensure(sip, **kw):
    return asyncio.run(setup_livekit.ensure(sip, allowed_addresses=kw.pop("allowed_addresses", ADDRESSES), **kw))


@pytest.mark.parametrize("given", [
    "p_vjnxecm0tjk", "vjnxecm0tjk", "sip:vjnxecm0tjk.sip.livekit.cloud", "vjnxecm0tjk.sip.livekit.cloud",
    " SIP:VJNXECM0TJK.sip.livekit.cloud ", "sip:ivr@vjnxecm0tjk.sip.livekit.cloud", "sip:vjnxecm0tjk.sip.livekit.cloud:5060",
])
def test_the_sip_address_comes_from_the_project_id_or_the_uri_in_project_settings(given):
    assert setup_livekit.sip_host(given) == "vjnxecm0tjk.sip.livekit.cloud"


@pytest.mark.parametrize("given", [
    "", "wss://extrahand-x225lfad.livekit.cloud", "extrahand-x225lfad.livekit.cloud", "https://x.livekit.cloud/",
    "wss://my-own-server.example.com", "sip:pbx.example.com", "not a host name!",
])
def test_the_web_address_of_a_project_is_not_its_sip_address(given):
    # LiveKit builds the SIP address from the project id (p_xxxx), not from the name in the web address;
    # a call to the guessed address gets "404 No trunk found" and Vobiz reports a network error.
    with pytest.raises(ValueError):
        setup_livekit.sip_host(given)


def test_the_trunk_maps_the_vobiz_headers_to_the_attributes_the_agent_reads():
    trunk = setup_livekit.trunk_request(allowed_addresses=ADDRESSES).trunk
    assert trunk.name == "extrahand-ivr-handoff" and list(trunk.numbers) == []
    assert dict(trunk.headers_to_attributes) == {"X-VH-Attempt": config.ATTR_ATTEMPT, "X-VH-Token": config.ATTR_TOKEN}
    assert trunk.include_headers == api.SIPHeaderOptions.SIP_X_HEADERS
    assert list(trunk.allowed_addresses) == ADDRESSES


def test_the_trunk_needs_credentials_or_an_address_list():
    with pytest.raises(ValueError):
        setup_livekit.trunk_request()
    with pytest.raises(ValueError):
        setup_livekit.trunk_request(auth=("user", ""))  # both a username and a password, or neither
    trunk = setup_livekit.trunk_request(auth=("user", "pw")).trunk
    assert (trunk.auth_username, trunk.auth_password) == ("user", "pw")


def test_the_rule_gives_each_call_its_own_room_and_dispatches_the_agent():
    rule = setup_livekit.rule_request("ST_abc").dispatch_rule
    assert list(rule.trunk_ids) == ["ST_abc"] and rule.name == "extrahand-ivr-handoff"
    assert rule.rule.dispatch_rule_individual.room_prefix == "ivr-handoff-"
    assert [a.agent_name for a in rule.room_config.agents] == [config.AGENT_NAME]


def test_a_dry_run_changes_nothing():
    sip = FakeSip()
    plan = _ensure(sip, dry_run=True)
    assert sip.created == [] and plan["trunk"]["action"] == "would create" and plan["rule"]["action"] == "would create"


def test_a_real_run_creates_the_trunk_then_the_rule_and_a_second_run_creates_nothing():
    sip = FakeSip()
    plan = _ensure(sip, dry_run=False)
    assert sip.created == ["trunk", "rule"]
    assert plan["trunk"] == {"action": "created", "id": "ST_new"} and plan["rule"]["id"] == "SDR_new"
    again = _ensure(sip, dry_run=False)
    assert sip.created == ["trunk", "rule"]
    assert again["trunk"]["action"] == "exists" and again["rule"]["action"] == "exists" and again["warnings"] == []


def test_an_existing_trunk_or_rule_that_differs_is_reported_and_never_changed():
    stale_trunk = api.SIPInboundTrunkInfo(sip_trunk_id="ST_old", name=setup_livekit.TRUNK_NAME)
    stale_rule = api.SIPDispatchRuleInfo(sip_dispatch_rule_id="SDR_old", name=setup_livekit.RULE_NAME, trunk_ids=["ST_other"])
    sip = FakeSip(trunks=[stale_trunk], rules=[stale_rule])
    plan = _ensure(sip, dry_run=False)
    assert sip.created == [] and len(plan["warnings"]) == 2
    assert any("header" in w for w in plan["warnings"]) and any("trunk" in w for w in plan["warnings"])


def test_main_dry_run_prints_the_plan_and_the_address_for_the_backend(capsys):
    sip = FakeSip()
    factory = lambda url, key, secret: SimpleNamespace(sip=sip, aclose=lambda: _done())  # noqa: E731

    async def _done():
        return None

    code = setup_livekit.main(["--dry-run", "--allowed-address", "203.0.113.0/27", "--sip-uri", "sip:vjnxecm0tjk.sip.livekit.cloud"], env={
        "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s"}, lkapi_factory=factory)
    out = capsys.readouterr().out
    assert code == 0 and sip.created == []
    assert "would create" in out and "HANDOFF_SIP_URI=sip:ivr@vjnxecm0tjk.sip.livekit.cloud" in out


def test_without_the_projects_sip_address_the_script_says_where_to_find_it_instead_of_guessing(capsys):
    sip = FakeSip()
    factory = lambda url, key, secret: SimpleNamespace(sip=sip, aclose=lambda: _done())  # noqa: E731

    async def _done():
        return None

    code = setup_livekit.main(["--dry-run", "--allowed-address", "203.0.113.0/27"], env={
        "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s"}, lkapi_factory=factory)
    out = capsys.readouterr().out
    assert code == 0 and "HANDOFF_SIP_URI=sip:ivr@x.sip.livekit.cloud" not in out
    assert "--sip-uri" in out and "Project settings" in out


def test_a_sip_address_that_is_really_the_web_address_is_refused(capsys):
    code = setup_livekit.main(["--dry-run", "--allowed-address", "203.0.113.0/27", "--sip-uri", "wss://x.livekit.cloud"], env={})
    assert code == 2 and "SIP" in capsys.readouterr().err


def test_main_refuses_a_trunk_without_credentials_or_addresses(capsys):
    code = setup_livekit.main(["--dry-run"], env={}, lkapi_factory=None)
    assert code == 2 and "allowed-address" in capsys.readouterr().err


def test_the_vobiz_option_allows_exactly_the_signaling_addresses_vobiz_publishes():
    # https://www.vobiz.ai/docs/concepts/ip-whitelisting (SIP signaling, inbound + outbound)
    published = {"13.203.7.132", "65.2.100.211", "13.126.98.234", "13.235.11.131", "13.233.44.61",
                 "3.111.255.163", "3.111.128.110", "43.204.64.203", "15.207.232.91", "35.154.133.28"}
    assert {a.removesuffix("/32") for a in setup_livekit.VOBIZ_SIP_ADDRESSES} == published
    assert all(a.endswith("/32") for a in setup_livekit.VOBIZ_SIP_ADDRESSES)


def test_main_with_the_vobiz_option_needs_no_other_access_setting(capsys):
    code = setup_livekit.main(["--dry-run", "--vobiz-addresses", "--sip-uri", "p_vjnxecm0tjk"], env={})
    out = capsys.readouterr().out
    assert code == 0 and "would create" in out and "HANDOFF_SIP_URI=sip:ivr@vjnxecm0tjk.sip.livekit.cloud" in out


def test_the_trunk_is_created_with_the_vobiz_addresses_when_asked():
    sip = FakeSip()
    asyncio.run(setup_livekit.ensure(sip, allowed_addresses=setup_livekit.VOBIZ_SIP_ADDRESSES, dry_run=False))
    assert sip.created == ["trunk", "rule"]
    assert list(sip.trunks[0].allowed_addresses) == list(setup_livekit.VOBIZ_SIP_ADDRESSES)
