# apexflow/backend/app/chat/__init__.py
"""Chat workflow builder (Plan 4): the pydantic-ai agent, its dependency
object, the SSE transport, and the tool registrations.

Layering, so later tasks add to the right file:
  deps.py    -- `ChatDeps`, the per-request state every tool closes over.
  stream.py  -- the SSE transport (token|tool|proposal|done|error). Ported
                verbatim from admindash; it is transport only and should not
                grow apexflow-specific logic.
  agent.py   -- system prompt + primitive catalog + agent construction.
  tools.py   -- read tools (Task 4) and proposal tools (Tasks 5-6).
"""
