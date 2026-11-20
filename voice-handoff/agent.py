"""
agent.py: the IVR hand-off voice agent (Maya's voice, a separate LiveKit agent).

A keypad IVR call placed by Vobiz is bridged here (Vobiz <Dial> to a LiveKit SIP address) in two cases only: a helper
pressing 2 on a reminder, and a customer rating a job 1 or 2 stars. The call arrives already connected. The agent reads
what it may know about the call from the backend, talks to the person for under two minutes, records one structured
result and hangs up. If it never records anything the backend ends the call exactly as the keypad alone would have.

Pipeline:  Person -> Sarvam STT (Saaras v3) -> OpenRouter LLM -> Sarvam TTS (Bulbul v3) -> Person.
Run the worker:  python agent.py dev   (production: python agent.py start)
"""

import asyncio
import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

from livekit import api  # noqa: E402
from livekit.agents import (  # noqa: E402
    Agent, AgentSession, JobContext, JobProcess, RoomInputOptions, RunContext, WorkerOptions, cli,
    function_tool, get_job_context, inference,
)
from livekit.plugins import openai, sarvam  # noqa: E402
from livekit.plugins.turn_detector.multilingual import MultilingualModel  # noqa: E402

import config  # noqa: E402
import prompts  # noqa: E402
import results  # noqa: E402
import sip_meta  # noqa: E402
from backend_client import BackendClient, BackendError  # noqa: E402
from textutils import (  # noqa: E402
    CallerInactivityTimer, apply_stt_corrections, clean_reply_text, looks_like_question, pick_tts_language,
    stream_clean_sentences,
)

logger = logging.getLogger(f"livekit.agents.{config.AGENT_NAME}")
_FALLBACK_LINE = "క్షమించండి, చిన్న సాంకేతిక సమస్య. మా team మీకు త్వరలో call చేస్తుంది. ధన్యవాదాలు."
_TIME_LINE = "సమయం అయిపోతోంది కాబట్టి ఇక్కడ ఆపుతున్నాను. మా team మీకు call చేస్తుంది. ధన్యవాదాలు."
_REQUIRED_RUNTIME_ENV = ("SARVAM_API_KEY", "OPENROUTER_API_KEY", "BACKEND_BASE_URL")


def _validate_runtime_env() -> None:
    missing = [key for key in _REQUIRED_RUNTIME_ENV if not os.environ.get(key)]
    if missing:
        raise RuntimeError(
            "Missing required agent environment variable(s): " + ", ".join(missing)
            + ". Set them in the LiveKit Cloud agent environment; a local .env is not in the deployed image.")


def prewarm(proc: JobProcess) -> None:
    _validate_runtime_env()
    # Done once when the process starts, not inside the call: this import alone took the better part of a second
    # of the time the caller waits for Maya to speak.
    from livekit.plugins import noise_cancellation  # noqa: F401

    logger.info("hand-off agent runtime environment check passed")


class HandoffAgent(Agent):
    def __init__(self, data: dict, client: BackendClient, attempt_id: int, token: str, transcript, hangup=None) -> None:
        self._data = data
        self._client = client
        self._attempt_id = attempt_id
        self._token = token
        self._transcript = transcript  # callable: the conversation so far, as text
        self._hangup_fn = hangup
        self._hung_up = False
        self.recorded = False
        super().__init__(instructions=prompts.system_prompt(data), tools=self._make_tools(data.get("purpose")))

    # -- tools: only the one this call needs ---------------------------------------------------------------
    async def _record(self, make_body) -> str:
        if self.recorded:
            return "That is already recorded; do not record it again. Thank the person briefly and call end_call."
        try:
            body = make_body()
        except ValueError as exc:
            return f"Not recorded: {exc}. Ask the person again, plainly."
        if not await self._client.post_result(self._attempt_id, self._token, body):
            logger.error("could not save the result for call %s", self._attempt_id)
            return ("The result could not be saved. Say sorry, tell the person the support team will contact them, "
                    "then call end_call.")
        self.recorded = True
        return ("Recorded. Thank the person in one short sentence, say the support team will take it from here, "
                "then call end_call.")

    def _make_tools(self, purpose: str | None) -> list:
        if purpose == "feedback":
            @function_tool(name="record_rating_result", description="Record what went wrong with the job the customer rated poorly.")
            async def record_rating_result(ctx: RunContext, complaint_category: str, details: str = "", summary: str = "") -> str:
                """Record the customer's complaint ONCE, after you know what went wrong.

                Args:
                    complaint_category: one of late_arrival, poor_service, incomplete_work, overcharging, rude_behavior, other.
                    details: what went wrong, in a few plain words.
                    summary: one plain sentence for the support team.
                """
                return await self._record(lambda: results.rating_body(complaint_category, details, summary, self._transcript()))

            return [record_rating_result]

        @function_tool(name="record_reminder_result", description="Record why the helper cannot come, or that they are running late.")
        async def record_reminder_result(ctx: RunContext, decision: str, reason: str = "", eta_minutes: int = 0,
                                         summary: str = "") -> str:
            """Record the helper's answer ONCE, after you know why and whether they can still come.

            Args:
                decision: "cannot_come" if they cannot do the job at all; "running_late" if they can still come, later.
                reason: why, in a few plain words.
                eta_minutes: only for running_late: how many minutes from now they expect to arrive (1 to 600).
                summary: one plain sentence for the support team.
            """
            return await self._record(
                lambda: results.reminder_body(decision, reason, eta_minutes or None, summary, self._transcript()))

        return [record_reminder_result]

    @function_tool()
    async def end_call(self, ctx: RunContext, goodbye: str) -> str | None:
        """Speak a final closing line and then hang up the phone call.

        This is the ONLY way to end a call. Record the person's answer first, then call this with `goodbye`
        set to one short closing sentence in the person's language. Do NOT write the closing line as an
        ordinary reply; pass it here so it is spoken and the line is then disconnected.

        Args:
            goodbye: The closing sentence to speak before hanging up, in the person's language.
        """
        goodbye = clean_reply_text(goodbye)
        if looks_like_question(goodbye):  # a mis-fired close: speak it, keep the line open
            if goodbye:
                await ctx.session.say(goodbye).wait_for_playout()
            return None
        if goodbye:
            await ctx.session.say(goodbye).wait_for_playout()
        logger.info("end_call invoked; closing line spoken, hanging up")
        await self.hangup()
        return None

    async def hangup(self) -> None:
        """Disconnect the call (delete the room), which ends the bridged leg on Vobiz. Idempotent."""
        if self._hung_up:
            return
        self._hung_up = True
        if self._hangup_fn is not None:
            await self._hangup_fn()
            return
        try:
            job_ctx = get_job_context()
            await job_ctx.api.room.delete_room(api.DeleteRoomRequest(room=job_ctx.room.name))
        except Exception:
            logger.exception("failed to delete room to hang up")

    async def on_enter(self):
        await self.session.say(prompts.opening(self._data), allow_interruptions=False).wait_for_playout()

    # -- speech pipeline nodes (as in Maya) -----------------------------------------------------------------
    async def stt_node(self, audio, model_settings):
        async for event in Agent.default.stt_node(self, audio, model_settings):
            for alt in getattr(event, "alternatives", None) or []:
                corrected = apply_stt_corrections(alt.text)
                if corrected != alt.text:
                    alt.text = corrected
            yield event

    async def tts_node(self, text, model_settings):
        spoken: list[str] = []

        def set_language(sample: str) -> None:
            tts = self.session.tts
            if hasattr(tts, "update_options"):
                tts.update_options(target_language_code=pick_tts_language(sample))

        async for frame in Agent.default.tts_node(
                self, stream_clean_sentences(text, set_language, spoken), model_settings):
            yield frame


def build_session() -> AgentSession:
    return AgentSession(
        turn_detection=MultilingualModel(),
        min_interruption_duration=0.8,
        min_interruption_words=3,
        preemptive_generation=True,
        vad=inference.VAD(model="silero", activation_threshold=0.6, min_speech_duration=0.2, min_silence_duration=0.45),
        stt=sarvam.STT(model=config.SARVAM_STT_MODEL, language=config.SARVAM_STT_LANGUAGE,
                       mode=config.SARVAM_STT_MODE, prompt=config.SARVAM_STT_PROMPT),
        llm=openai.LLM(model=config.OPENROUTER_MODEL, api_key=os.environ["OPENROUTER_API_KEY"],
                       base_url=config.OPENROUTER_BASE_URL),
        tts=sarvam.TTS(model=config.SARVAM_TTS_MODEL, speaker=config.SARVAM_TTS_SPEAKER,
                       target_language_code=config.SARVAM_TTS_LANGUAGE, pace=config.SARVAM_TTS_SPEED,
                       temperature=config.SARVAM_TTS_TEMPERATURE, min_buffer_size=config.SARVAM_TTS_MIN_BUFFER_SIZE,
                       enable_preprocessing=config.SARVAM_TTS_ENABLE_PREPROCESSING),
    )


def transcript_text(session) -> str:
    lines = []
    for item in session.history.to_dict().get("items", []):
        if item.get("type") != "message":
            continue
        text = " ".join(c for c in (item.get("content") or []) if isinstance(c, str)).strip()
        if text:
            lines.append(f"{item.get('role', '?')}: {text}")
    return "\n".join(lines)


async def apologise_and_hang_up(ctx: JobContext, session, room_input_options) -> None:
    """The call cannot be handled (no call id, or the backend would not give its context). Say sorry and hang up;
    the backend, which never hears from the agent, ends the call as the keypad alone would have."""
    await session.start(agent=Agent(instructions="Say nothing unless told to."), room=ctx.room,
                        room_input_options=room_input_options)
    try:
        await session.say(_FALLBACK_LINE).wait_for_playout()
    except Exception:
        logger.exception("could not speak the apology")
    await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))


async def run_conversation(ctx: JobContext, participant, session, client, attempt_id: int, token: str, data: dict, *,
                           room_input_options) -> None:
    agent = HandoffAgent(data, client, attempt_id, token, transcript=lambda: transcript_text(session))

    async def silent_timeout() -> None:
        logger.info("caller inactivity timeout; ending the call")
        await agent.hangup()

    inactivity = CallerInactivityTimer(config.CALLER_INACTIVITY_SECONDS, silent_timeout)
    session.on("agent_state_changed", lambda event: inactivity.on_agent_state(event.new_state))
    session.on("user_state_changed", lambda event: inactivity.on_user_state(event.new_state))

    async def talk_limit() -> None:
        await asyncio.sleep(config.TALK_LIMIT_SECONDS)
        logger.info("talk limit reached; closing the call")
        try:
            await session.say(_TIME_LINE).wait_for_playout()
        except Exception:
            logger.exception("could not speak the time-limit line")
        await agent.hangup()

    limit_task = asyncio.create_task(talk_limit(), name="talk-limit")

    async def finish() -> None:
        inactivity.close()
        limit_task.cancel()

    ctx.add_shutdown_callback(finish)
    await session.start(agent=agent, room=ctx.room, room_input_options=room_input_options)
    if getattr(session, "room_io", None):
        session.room_io.set_participant(participant.identity)
    inactivity.enable()


async def entrypoint(ctx: JobContext) -> None:
    started = time.monotonic()

    def lap(what: str) -> None:  # where the caller's waiting time goes, in the log of every call
        logger.info("hand-off timing: %s after %.2fs", what, time.monotonic() - started)

    logger.info("hand-off job received for room %s", ctx.room.name)
    _validate_runtime_env()
    await ctx.connect()
    from livekit.plugins import noise_cancellation  # already imported at process start by prewarm

    participant = await ctx.wait_for_participant()
    lap("caller on the line")
    attributes = dict(participant.attributes or {})
    room_input_options = RoomInputOptions(noise_cancellation=noise_cancellation.BVCTelephony(),
                                          participant_identity=participant.identity)
    session = build_session()
    spoke: list[int] = []
    client = BackendClient(config.backend_base_url())

    async def close_client() -> None:
        await client.aclose()

    ctx.add_shutdown_callback(close_client)
    meta = sip_meta.read(attributes, attributes.get(config.SIP_CALLED_NUMBER_ATTR))
    if meta is None:
        logger.error("no call id and token on the SIP participant (attributes: %s)", sorted(attributes))
        await apologise_and_hang_up(ctx, session, room_input_options)
        return
    attempt_id, token = meta
    try:
        data = await client.get_context(attempt_id, token)
        lap("context read")
    except BackendError as exc:
        logger.error("could not read the context of call %s: %s", attempt_id, exc)
        await apologise_and_hang_up(ctx, session, room_input_options)
        return

    def note_first_words(event) -> None:
        if event.new_state == "speaking" and not spoke:
            spoke.append(True)
            lap("Maya speaking")

    session.on("agent_state_changed", note_first_words)
    await run_conversation(ctx, participant, session, client, attempt_id, token, data,
                           room_input_options=room_input_options)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=config.AGENT_NAME))
