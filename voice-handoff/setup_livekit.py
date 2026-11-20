"""Sets up the LiveKit side of the IVR hand-off: an inbound SIP trunk that accepts the call Vobiz bridges, and a
dispatch rule that puts each call in its own room with the hand-off agent. Idempotent by name: what already exists
is reported, never changed.

    python setup_livekit.py --dry-run --vobiz-addresses --sip-uri <SIP URI>   show what would be created
    python setup_livekit.py --vobiz-addresses --sip-uri <SIP URI>             create what is missing, print HANDOFF_SIP_URI
(--allowed-address <CIDR>, repeatable, adds any other address)

--sip-uri is the SIP address shown in LiveKit Cloud > Project settings (sip:<id>.sip.livekit.cloud) or the project id
(p_<id>); it is built from the project id, not from the project's web address, so it cannot be worked out from LIVEKIT_URL.

A trunk that accepts any called number (ours is called ivr-<attempt>-<token>, not a phone number) must carry SIP
credentials (--auth-username/--auth-password) or the addresses Vobiz sends from (--allowed-address, repeatable; LiveKit
has to enable that field for the project). Needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET, from the
environment or from --env-file."""

import argparse
import asyncio
import os
import re
import sys

from livekit import api

import config

TRUNK_NAME = RULE_NAME = "extrahand-ivr-handoff"
ROOM_PREFIX = "ivr-handoff-"
# Vobiz sends the bridge's sipHeaders (Attempt, Token) with an X-VH- prefix; the agent reads them as these attributes.
HEADER_ATTRIBUTES = {"X-VH-Attempt": config.ATTR_ATTEMPT, "X-VH-Token": config.ATTR_TOKEN}
_ENV_KEYS = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
_SIP_ENV_KEY = "LIVEKIT_SIP_URI"
# Where Vobiz's SIP signaling comes from, as published at https://www.vobiz.ai/docs/concepts/ip-whitelisting.
VOBIZ_SIP_ADDRESSES = tuple(f"{ip}/32" for ip in (
    "13.203.7.132", "65.2.100.211", "13.126.98.234", "13.235.11.131", "13.233.44.61",
    "3.111.255.163", "3.111.128.110", "43.204.64.203", "15.207.232.91", "35.154.133.28"))
_PROJECT_ID = re.compile(r"^(?:p_)?([a-z0-9]{6,20})$")
_SIP_HOST = re.compile(r"^[a-z0-9]{6,20}\.sip\.livekit\.cloud$")
_ACCESS_HELP = ("a trunk that accepts any called number needs SIP credentials (--auth-username and --auth-password) "
                "or the addresses Vobiz sends from (--allowed-address, repeatable)")


def sip_host(value: str) -> str:
    """The project's SIP host on LiveKit Cloud, from its project id (p_xxxx) or the SIP URI shown in Project settings
    (sip:xxxx.sip.livekit.cloud). It cannot be worked out from the project's web address: LiveKit builds it from the
    project id, and a call to a guessed host is refused with "404 No trunk found" (Vobiz reports a network error)."""
    text = (value or "").strip().lower()
    if match := _PROJECT_ID.match(text):
        return f"{match.group(1)}.sip.livekit.cloud"
    host = text.removeprefix("sip:").rpartition("@")[2].split(";")[0].split(":")[0]
    if _SIP_HOST.match(host):
        return host
    raise ValueError(f"{value!r} is not the project's SIP address; copy the SIP URI from LiveKit Cloud > Project settings "
                     "(sip:<id>.sip.livekit.cloud), or give the project id (p_<id>). The web address does not contain it")


def trunk_request(allowed_addresses=(), auth: tuple[str, str] | None = None) -> api.CreateSIPInboundTrunkRequest:
    username, password = auth or ("", "")
    if bool(username) != bool(password):
        raise ValueError("give both a username and a password, or neither")
    if not allowed_addresses and not username:
        raise ValueError(_ACCESS_HELP)
    return api.CreateSIPInboundTrunkRequest(trunk=api.SIPInboundTrunkInfo(
        name=TRUNK_NAME, headers_to_attributes=HEADER_ATTRIBUTES, include_headers=api.SIPHeaderOptions.SIP_X_HEADERS,
        allowed_addresses=list(allowed_addresses), auth_username=username, auth_password=password))


def rule_request(trunk_id: str) -> api.CreateSIPDispatchRuleRequest:
    return api.CreateSIPDispatchRuleRequest(dispatch_rule=api.SIPDispatchRuleInfo(
        name=RULE_NAME, trunk_ids=[trunk_id],
        rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix=ROOM_PREFIX)),
        room_config=api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=config.AGENT_NAME)])))


async def ensure(sip, *, allowed_addresses=(), auth=None, dry_run: bool = True) -> dict:
    """Finds or creates the trunk and the dispatch rule. With ``dry_run`` nothing is created."""
    warnings: list[str] = []
    plan: dict = {"warnings": warnings}

    trunks = (await sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())).items
    trunk = next((t for t in trunks if t.name == TRUNK_NAME), None)
    trunk_id = None
    if trunk is None:
        request = trunk_request(allowed_addresses, auth)  # validated before anything is created
        if dry_run:
            plan["trunk"] = {"action": "would create", "id": None}
        else:
            trunk_id = (await sip.create_inbound_trunk(request)).sip_trunk_id
            plan["trunk"] = {"action": "created", "id": trunk_id}
    else:
        trunk_id = trunk.sip_trunk_id
        plan["trunk"] = {"action": "exists", "id": trunk_id}
        if dict(trunk.headers_to_attributes) != HEADER_ATTRIBUTES:
            warnings.append("the existing trunk's header mapping differs from what the agent reads "
                            f"({HEADER_ATTRIBUTES}); fix it in the LiveKit dashboard")

    rules = (await sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())).items
    rule = next((r for r in rules if r.name == RULE_NAME), None)
    if rule is None:
        if dry_run or trunk_id is None:
            plan["rule"] = {"action": "would create", "id": None}
        else:
            plan["rule"] = {"action": "created", "id": (await sip.create_dispatch_rule(rule_request(trunk_id))).sip_dispatch_rule_id}
    else:
        plan["rule"] = {"action": "exists", "id": rule.sip_dispatch_rule_id}
        if trunk_id and trunk_id not in list(rule.trunk_ids):
            warnings.append("the existing dispatch rule is not attached to the trunk above; fix it in the LiveKit dashboard")
    return plan


def _print_plan(plan: dict, sip: str | None, dry_run: bool) -> None:
    print(f"Inbound trunk {TRUNK_NAME!r}: {plan['trunk']['action']}" + (f" ({plan['trunk']['id']})" if plan["trunk"]["id"] else ""))
    print(f"Dispatch rule {RULE_NAME!r}: {plan['rule']['action']}" + (f" ({plan['rule']['id']})" if plan["rule"]["id"] else ""))
    for warning in plan["warnings"]:
        print(f"WARNING: {warning}")
    if dry_run:
        print("(dry run: nothing was changed)")
    if sip:
        print(f"HANDOFF_SIP_URI=sip:ivr@{sip}")
    else:
        print("HANDOFF_SIP_URI: not printed because the project's SIP address is not known. Run again with --sip-uri "
              "(LiveKit Cloud > Project settings > SIP URI, or the project id p_<id>); it cannot be guessed from the web address.")


def main(argv=None, env=None, lkapi_factory=None) -> int:
    parser = argparse.ArgumentParser(description="Create the LiveKit trunk and dispatch rule for the IVR hand-off agent.")
    parser.add_argument("--dry-run", action="store_true", help="show what would be created; change nothing")
    parser.add_argument("--allowed-address", action="append", default=[], metavar="CIDR",
                        help="an address Vobiz sends the bridged call from (repeatable)")
    parser.add_argument("--vobiz-addresses", action="store_true",
                        help="allow the SIP signaling addresses Vobiz publishes (instead of or as well as --allowed-address)")
    parser.add_argument("--auth-username")
    parser.add_argument("--auth-password")
    parser.add_argument("--sip-uri", help="the project's SIP address: Project settings > SIP URI, or its project id (p_<id>); "
                                          f"also read from {_SIP_ENV_KEY}")
    parser.add_argument("--env-file", help=f".env file holding {', '.join(_ENV_KEYS)}")
    args = parser.parse_args(argv)
    if args.vobiz_addresses:
        args.allowed_address = [*args.allowed_address, *VOBIZ_SIP_ADDRESSES]

    env = dict(os.environ if env is None else env)
    if args.env_file:
        from dotenv import dotenv_values
        env.update({k: v for k, v in dotenv_values(args.env_file).items() if k in (*_ENV_KEYS, _SIP_ENV_KEY) and v})
    given_sip = args.sip_uri or env.get(_SIP_ENV_KEY)
    try:
        sip = sip_host(given_sip) if given_sip else None
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    auth = (args.auth_username or "", args.auth_password or "") if (args.auth_username or args.auth_password) else None
    credentials = [env.get(k) for k in _ENV_KEYS]

    if not all(credentials):
        if not args.dry_run:
            print(f"error: set {', '.join(_ENV_KEYS)} (in the environment or with --env-file)", file=sys.stderr)
            return 2
        try:
            trunk_request(args.allowed_address, auth)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print("Offline dry run (no LiveKit credentials): would create the inbound trunk and the dispatch rule.")
        _print_plan({"warnings": [], "trunk": {"action": "would create", "id": None},
                     "rule": {"action": "would create", "id": None}}, sip, True)
        return 0

    url, key, secret = credentials

    async def run() -> dict:
        lkapi = (lkapi_factory or (lambda u, k, s: api.LiveKitAPI(url=u, api_key=k, api_secret=s)))(url, key, secret)
        try:
            return await ensure(lkapi.sip, allowed_addresses=args.allowed_address, auth=auth, dry_run=args.dry_run)
        finally:
            await lkapi.aclose()

    try:
        plan = asyncio.run(run())
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    _print_plan(plan, sip, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
