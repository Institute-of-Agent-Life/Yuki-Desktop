"""Extra local media inputs; use the selected backend's real snapshot/send paths."""
import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import FastAPI
from sqlalchemy import select
from tests.support.desktop_fault_fixture import DesktopFaultFixture
from tests.support.desktop_reference_server import main
from tests.support.workspace_snapshots import snapshot_bytes
from yuki.persistence.models import ChatEventModel, ConversationMediaItemModel
from yuki.social.service import SocialContext

attach = DesktopFaultFixture.attach


def media_routes(self, app: FastAPI):
    attach(self, app)

    @app.post("/__test/media-expiry/{event_id}")
    async def expiry(event_id: int):
        async with self.runtime.database.immediate_session() as writer:
            rows = await writer.scalars(select(ConversationMediaItemModel).where(ConversationMediaItemModel.source_event_id == event_id))
            for item in rows:
                item.expires_at = datetime.now(UTC) + timedelta(seconds=3)
        expire = next(route.endpoint for route in app.routes if getattr(route, "path", "") == "/__test/expire-attachments/{event_id}")

        async def remove_original():
            await asyncio.sleep(2.9)
            await expire(event_id)

        asyncio.create_task(remove_original())
        return {"ok": True}

    @app.post("/__test/media-artifact")
    async def publish(body: dict):
        path = (self.root / body["path"]).resolve()
        assert path.is_relative_to(self.root.resolve())
        runtime = self.runtime
        async with runtime.database.read_session() as reader:
            original = await reader.scalar(
                select(ChatEventModel)
                .where(ChatEventModel.author_person_id == self.person, ChatEventModel.direction == "inbound")
                .order_by(ChatEventModel.id.desc()).limit(1)
            )
        assert original is not None
        item = await asyncio.to_thread(snapshot_bytes, runtime.workspace_service.store, path.name, path.read_bytes())
        result = await runtime.social_service.execute(
            "send",
            {"artifact_id": item["artifact_id"], "attachment_kind": body.get("kind", "file"), "text": body.get("text", "Media " + path.name)},
            SocialContext(f"fixture:{uuid4()}", "artifact", original.canonical_conversation_id,
                          person_refs={"current_speaker": self.person}, trigger_event_id=original.id,
                          reply_presence_id=original.ingress_presence_id),
        )
        assert result["status"] == "succeeded", result
        return {**item, "event_id": result["event_id"]}


DesktopFaultFixture.attach = media_routes
main()
