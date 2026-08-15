# apexflow/backend/app/chat/tools.py
"""Chat agent tool registrations.

Both functions are deliberate no-ops for now: `build_chat_agent` calls them
unconditionally, so they must exist for the agent to build.
"""
from pydantic_ai import Agent


def register_read_tools(agent: Agent) -> None:
    """filled in by Tasks 4-6"""


def register_proposal_tools(agent: Agent) -> None:
    """filled in by Tasks 4-6"""
