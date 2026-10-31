"""Seed content-free invocation facts in the isolated E2E Bot, never call a model."""

import argparse
import asyncio
import json
from pathlib import Path

from yuki.model_runtime.models import ModelTask
from yuki.model_runtime.repository import ModelInvocationRepository
from yuki.persistence.database import Database


async def seed(root: Path, mode: str) -> None:
    database = Database(f"sqlite+aiosqlite:///{(root / 'yuki.sqlite3').as_posix()}")
    repository = ModelInvocationRepository(database)
    rows = (
        [
            dict(
                profile_id="usage-known",
                task=ModelTask.MEMORY_EXTRACTION,
                success=True,
                prompt_tokens=1200,
                completion_tokens=37,
                total_tokens=1237,
                cached_prompt_tokens=400,
                cache_creation_input_tokens=31,
                latency_seconds=1.25,
            ),
            dict(
                profile_id="usage-known",
                task=ModelTask.MEMORY_EXTRACTION,
                success=False,
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                cached_prompt_tokens=None,
                cache_creation_input_tokens=None,
                latency_seconds=3.75,
            ),
            dict(
                profile_id="usage-zero",
                task=ModelTask.MEMORY_DREAM,
                success=True,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                cached_prompt_tokens=0,
                cache_creation_input_tokens=0,
                latency_seconds=0,
            ),
            dict(
                profile_id="usage-search",
                task="web_search",
                success=True,
                prompt_tokens=1,
                completion_tokens=2,
                total_tokens=3,
                cached_prompt_tokens=0,
                cache_creation_input_tokens=0,
                latency_seconds=0.125,
            ),
        ]
        if mode == "first"
        else [
            dict(
                profile_id="other-yuki",
                task=ModelTask.UTILITY_STRUCTURED,
                success=True,
                prompt_tokens=8,
                completion_tokens=2,
                total_tokens=10,
                cached_prompt_tokens=0,
                cache_creation_input_tokens=0,
                latency_seconds=0.5,
            ),
        ]
    )
    try:
        recorded = []
        for row in rows:
            record = await repository.record(
                **row,
                provider="fixture-usage",
                model="fixture-usage-model",
                error_category=None if row["success"] else "provider_unavailable",
                physical_request_count=1,
                unknown_usage_request_count=1 if row["total_tokens"] is None else 0,
            )
            recorded.append(record.model_dump(mode="json"))
        print(
            json.dumps(
                {"method": "ModelInvocationRepository.record", "records": recorded}
            )
        )
    finally:
        await database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--mode", choices=("first", "second"), required=True)
    arguments = parser.parse_args()
    asyncio.run(seed(arguments.root, arguments.mode))
