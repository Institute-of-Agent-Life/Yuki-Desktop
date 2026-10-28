"""Extra local media inputs; use the selected backend's real snapshot/send paths."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import FastAPI
from sqlalchemy import select
from tests.support.desktop_fault_fixture import DesktopFaultFixture
from tests.support.desktop_reference_server import main
from tests.support.workspace_snapshots import snapshot_bytes
from yuki.conversation.canonical_db_models import CanonicalConversationModel
from yuki.persistence.models import (
    ChatEventArtifactRefModel,
    ChatEventModel,
    ConversationMediaItemModel,
)
from yuki.plugin_host.db_models import PluginNotificationOutboxModel
from yuki.plugin_host.repository import PluginInstallationRepository
from yuki.social.service import SocialContext
from yuki_plugin_sdk import PLUGIN_API_VERSION
from yuki_plugin_sdk.models import NotificationTarget, PublishNotificationRequest

attach = DesktopFaultFixture.attach


def media_routes(self, app: FastAPI):
    attach(self, app)

    @app.post("/__test/plugin-notification")
    async def plugin_notification(body: dict):
        runtime = self.runtime
        path = (self.root / body["path"]).resolve()
        assert path.is_relative_to(self.root.resolve())
        plugin_id = "desktop-notification-fixture"
        installations = PluginInstallationRepository(runtime.database)
        manifest = {
            "id": plugin_id,
            "name": "Desktop notification fixture",
            "version": "1.0",
            "plugin_api": PLUGIN_API_VERSION,
            "yuki_requires": ">=4",
            "entrypoint": "fixture:Plugin",
        }
        await installations.upsert_discovered(
            plugin_id=plugin_id,
            name=manifest["name"],
            version=manifest["version"],
            plugin_api=PLUGIN_API_VERSION,
            yuki_requires=manifest["yuki_requires"],
            entrypoint=manifest["entrypoint"],
            requested_permissions=(),
            manifest_hash=hashlib.sha256(
                json.dumps(manifest, sort_keys=True).encode()
            ).hexdigest(),
        )
        await installations.approve(plugin_id)
        await installations.set_enabled(plugin_id, enabled=True)
        installation = await installations.set_status(plugin_id, status="running")
        async with runtime.database.read_session() as reader:
            conversation = await reader.get(
                CanonicalConversationModel, body["conversationId"]
            )
            assert conversation.person_id == self.person
            presence = conversation.entry_presence_id
        target = NotificationTarget(
            target_type="private",
            target_id=self.person,
            conversation_id=body["conversationId"],
        )
        repository = runtime.plugin_notification_repository
        await repository.grant_target(
            plugin_id=plugin_id,
            target=target,
            bot_user_id="yuki-app",
            created_by_user_id=self.person,
            presence_id=presence,
        )
        original = await runtime.plugin_media_artifacts.create(
            plugin_id=plugin_id,
            data=path.read_bytes(),
            content_type="image/gif",
            filename=path.name,
            ttl_seconds=60,
            storage_mb=5,
        )
        receipt = await repository.publish(
            plugin_id=plugin_id,
            request=PublishNotificationRequest(
                event_key="desktop-original-image",
                event_type="fixture",
                external_source="desktop-fixture",
                target=target,
                occurred_at=datetime.now(UTC),
                summary="Approved plugin original image",
                text="",
                media_handles=(original.handle_id,),
            ),
        )
        # Start the actual Host worker; the test never inserts a delivery event itself.
        await runtime.plugin_notification_outbox.start()
        runtime.plugin_notification_outbox.wake()
        return {
            "plugin_id": plugin_id,
            "notification_id": receipt.notification_id,
            "source_event_id": receipt.source_event_id,
            "media_handle_id": original.handle_id,
            "sha256": original.sha256,
            "filename": original.filename,
            "installation": {
                "plugin_api": installation.plugin_api,
                "status": installation.status,
                "enabled": installation.enabled,
                "approved_at": installation.approved_at.isoformat(),
                "manifest_hash": installation.manifest_hash,
                "approved_permissions": installation.approved_permissions,
            },
        }

    @app.get("/__test/plugin-notification/{notification_id}")
    async def notification_receipt(notification_id: str):
        async with self.runtime.database.read_session() as reader:
            rows = list(
                await reader.scalars(
                    select(PluginNotificationOutboxModel).where(
                        PluginNotificationOutboxModel.notification_id == notification_id
                    )
                )
            )
            items = []
            for row in rows:
                event = (
                    await reader.get(ChatEventModel, row.event_id)
                    if row.event_id
                    else None
                )
                references = (
                    list(
                        await reader.scalars(
                            select(ChatEventArtifactRefModel).where(
                                ChatEventArtifactRefModel.event_id == row.event_id
                            )
                        )
                    )
                    if row.event_id
                    else []
                )
                items.append(
                    {
                        "outbox_id": row.id,
                        "status": row.status,
                        "event_id": row.event_id,
                        "source_event_id": row.source_event_id,
                        "platform_message_id": row.platform_message_id,
                        "prepared": json.loads(row.prepared_json)
                        if row.prepared_json
                        else None,
                        "event": {
                            "id": event.id,
                            "caused_by_event_id": event.caused_by_event_id,
                            "native_message_id": event.native_message_id,
                            "origin_key": event.origin_key,
                            "conversation_id": event.canonical_conversation_id,
                        }
                        if event
                        else None,
                        "references": [
                            {"artifact_id": ref.artifact_id, "version": ref.version}
                            for ref in references
                        ],
                    }
                )
        return {"items": items}

    @app.post("/__test/media-expiry/{event_id}")
    async def expiry(event_id: int):
        async with self.runtime.database.immediate_session() as writer:
            rows = await writer.scalars(
                select(ConversationMediaItemModel).where(
                    ConversationMediaItemModel.source_event_id == event_id
                )
            )
            for item in rows:
                item.expires_at = datetime.now(UTC) + timedelta(seconds=3)
        expire = next(
            route.endpoint
            for route in app.routes
            if getattr(route, "path", "") == "/__test/expire-attachments/{event_id}"
        )

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
                .where(
                    ChatEventModel.author_person_id == self.person,
                    ChatEventModel.direction == "inbound",
                )
                .order_by(ChatEventModel.id.desc())
                .limit(1)
            )
        assert original is not None
        item = await asyncio.to_thread(
            snapshot_bytes,
            runtime.workspace_service.store,
            path.name,
            path.read_bytes(),
        )
        result = await runtime.social_service.execute(
            "send",
            {
                "artifact_id": item["artifact_id"],
                "attachment_kind": body.get("kind", "file"),
                "text": body.get("text", "Media " + path.name),
            },
            SocialContext(
                f"fixture:{uuid4()}",
                "artifact",
                original.canonical_conversation_id,
                person_refs={"current_speaker": self.person},
                trigger_event_id=original.id,
                reply_presence_id=original.ingress_presence_id,
            ),
        )
        assert result["status"] == "succeeded", result
        return {**item, "event_id": result["event_id"]}


DesktopFaultFixture.attach = media_routes
main()
