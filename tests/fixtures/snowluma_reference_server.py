"""Run the reference backend with a loopback RFB source for the QQ desktop."""

import asyncio
import json
import os
import struct
from itertools import count
from tests.support import desktop_reference_server

VERSION = b"RFB 003.008\n"
WIDTH, HEIGHT = 640, 480
serve = desktop_reference_server.serve


async def serve_with_qq(root, *args, **kwargs):
    receipts = root / "qq-rfb.jsonl"
    receipts.touch()
    sessions = count(1)

    def record(session, kind, **details):
        with receipts.open("a", encoding="utf-8") as file:
            file.write(json.dumps({"session": session, "kind": kind, **details}) + "\n")

    async def desktop(reader, writer):
        session = next(sessions)
        record(session, "open")
        try:
            writer.write(VERSION)
            assert await reader.readexactly(len(VERSION)) == VERSION
            writer.write(b"\x01\x02")
            assert await reader.readexactly(1) == b"\x02"
            writer.write(bytes(16))
            await reader.readexactly(16)
            writer.write(bytes(4))
            await reader.readexactly(1)
            writer.write(
                struct.pack(
                    ">HHBBBBHHHBBBxxxI",
                    WIDTH,
                    HEIGHT,
                    32,
                    24,
                    0,
                    1,
                    255,
                    255,
                    255,
                    16,
                    8,
                    0,
                    2,
                )
                + b"QQ"
            )
            await writer.drain()
            first_frame = True
            while True:
                kind = (await reader.readexactly(1))[0]
                if kind == 2:
                    _, encodings = struct.unpack(">BH", await reader.readexactly(3))
                    await reader.readexactly(4 * encodings)
                    continue
                payload = await reader.readexactly({0: 19, 3: 9, 4: 7, 5: 5}[kind])
                if kind == 3 and first_frame:
                    first_frame = False
                    writer.write(
                        struct.pack(">BBHHHHHi", 0, 0, 1, 0, 0, WIDTH, HEIGHT, 0)
                    )
                    writer.write(b"\x16\x75\xe1\0" * (WIDTH * HEIGHT))
                    await writer.drain()
                elif kind == 4:
                    down, key = struct.unpack(">BxxI", payload)
                    record(session, "key", down=bool(down), key=key)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()
            record(session, "close")
            await writer.wait_closed()

    server = await asyncio.start_server(desktop, "127.0.0.1", 0)
    async with server:
        os.environ.update(
            COMPOSE_PROFILES="snowluma",
            SNOWLUMA_VNC_HOST="127.0.0.1",
            SNOWLUMA_VNC_PORT=str(server.sockets[0].getsockname()[1]),
            SNOWLUMA_VNC_PASSWORD="fixture",
        )
        await serve(root, *args, **kwargs)


if __name__ == "__main__":
    desktop_reference_server.serve = serve_with_qq
    desktop_reference_server.main()
