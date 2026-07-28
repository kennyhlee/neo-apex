import httpx
import pytest
import respx

from app.chat.datacore import ChatDeps, dc_query

pytestmark = pytest.mark.anyio
DATACORE = "http://datacore.test"


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_dc_query_hits_readonly_endpoint():
    deps = ChatDeps(tenant_id="t1", token="Bearer x", datacore_url=DATACORE)
    with respx.mock:
        route = respx.post(f"{DATACORE}/api/query/readonly").mock(
            return_value=httpx.Response(200, json={"data": [{"entity_id": "s1"}], "total": 1}))
        rows = await dc_query(deps, "SELECT * FROM data", table="models")
    assert route.called
    import json as _json
    body = _json.loads(route.calls.last.request.content)
    assert body["table"] == "models"
    assert rows == [{"entity_id": "s1"}]
