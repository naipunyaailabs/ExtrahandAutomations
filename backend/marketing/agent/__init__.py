"""Marketing agents: only the poster agent (designs a poster for each registered festival)."""

from .poster_agent import AIPosterAgent, poster_agent

PosterAgent = AIPosterAgent

__all__ = ["AIPosterAgent", "poster_agent", "PosterAgent"]
