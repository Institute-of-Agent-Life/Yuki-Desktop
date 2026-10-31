"""Seed original, content-free SQLite invocation facts; never invoke a provider."""

import argparse
import asyncio
import json
from datetime import datetime, timedelta
from pathlib import Path

from yuki.model_runtime.db_models import ModelInvocationModel
from yuki.persistence.database import Database


async def seed(root: Path, mode: str, midnight: datetime, timezone: str) -> None:
    database = Database(f"sqlite+aiosqlite:///{(root / 'yuki.sqlite3').as_posix()}")

    def row(**changes):
        return {
            "task": "chat_agent",
            "provider": "fixture-vendor",
            "model": "gemini-live",
            "profile_id": "connection_current",
            "success": True,
            "prompt_tokens": 1000,
            "completion_tokens": 100,
            "total_tokens": 1100,
            "cached_prompt_tokens": 500,
            "cache_creation_input_tokens": None,
            "cache_creation_5m_input_tokens": None,
            "cache_creation_1h_input_tokens": None,
            "physical_request_count": 1,
            "unknown_usage_request_count": 0,
            "latency_seconds": 1.25,
            "error_category": None,
            "created_at": midnight,
            **changes,
        }

    unknown = row(
        profile_id="removed-profile",
        success=False,
        prompt_tokens=None,
        completion_tokens=None,
        total_tokens=None,
        cached_prompt_tokens=None,
        unknown_usage_request_count=1,
        latency_seconds=3.75,
        error_category="provider_unavailable",
    )
    if mode == "first":
        facts = [
            row(
                cache_creation_input_tokens=31,
                cache_creation_5m_input_tokens=11,
                cache_creation_1h_input_tokens=20,
            ),
            row(
                task="memory_extraction",
                profile_id="connection_current.legacy-agent",
                prompt_tokens=200,
                completion_tokens=20,
                total_tokens=220,
                cached_prompt_tokens=None,
                latency_seconds=2,
            ),
            row(
                model="gemini-previous",
                prompt_tokens=300,
                completion_tokens=30,
                total_tokens=330,
                cached_prompt_tokens=100,
                latency_seconds=3,
            ),
            row(
                provider="other-vendor",
                prompt_tokens=400,
                completion_tokens=40,
                total_tokens=440,
                cached_prompt_tokens=200,
                latency_seconds=4,
            ),
            {**unknown, "cached_prompt_tokens": 30},
            row(
                task="web_search",
                profile_id="zero-profile",
                model="zero-model",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                cached_prompt_tokens=0,
                latency_seconds=0,
            ),
            row(
                profile_id="yesterday-profile",
                model="yesterday-model",
                prompt_tokens=90,
                completion_tokens=10,
                total_tokens=100,
                cached_prompt_tokens=0,
                created_at=midnight - timedelta(hours=1),
            ),
            row(
                task="planner",
                profile_id="flash",
                model="historical-planner-model",
                prompt_tokens=4500,
                completion_tokens=500,
                total_tokens=5000,
                cached_prompt_tokens=None,
                created_at=midnight - timedelta(days=40),
            ),
        ]
    elif mode == "second":
        facts = [
            row(
                profile_id="other-yuki",
                model="other-yuki-model",
                task="utility_structured",
                prompt_tokens=8,
                completion_tokens=2,
                total_tokens=10,
                cached_prompt_tokens=0,
                latency_seconds=0.5,
            )
        ]
    elif mode == "unknown":
        facts = [unknown]
    else:
        facts = []
    try:
        records = [ModelInvocationModel(**fact) for fact in facts]
        async with database.immediate_session() as writer:
            writer.add_all(records)
            await writer.flush()
        print(
            json.dumps(
                {
                    "method": "ModelInvocationModel",
                    "timezone": timezone,
                    "midnight": midnight.isoformat(),
                    "records": [
                        {"id": record.id, **fact, "created_at": fact["created_at"].isoformat()}
                        for record, fact in zip(records, facts, strict=True)
                    ],
                }
            )
        )
    finally:
        await database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--mode", choices=("first", "second", "unknown", "empty"), required=True)
    parser.add_argument("--midnight", type=datetime.fromisoformat, required=True)
    parser.add_argument("--timezone", required=True)
    args = parser.parse_args()
    asyncio.run(seed(args.root, args.mode, args.midnight, args.timezone))
