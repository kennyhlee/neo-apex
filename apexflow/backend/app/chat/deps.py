# apexflow/backend/app/chat/deps.py
"""Per-request dependency object for the chat agent.

apexflow keeps this in its own module (admindash carries the equivalent in
`app/chat/datacore.py` alongside its DataCore helpers) because every later
backend task in Plan 4 imports it — tools, stream, and route — and a
dedicated module keeps that import free of any DataCore coupling.
"""
from dataclasses import dataclass, field


@dataclass
class ChatDeps:
    tenant_id: str
    token: str | None
    page: str  # 'list' | 'templates' | 'editor'
    entity_id: str | None = None
    editor_context: str | None = None  # set by the route when page == 'editor' (Task 6)
    pending_proposals: list[dict] = field(default_factory=list)
