from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Sequence


DEFAULT_ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080


def create_server(
    port: int = DEFAULT_PORT,
    root: Path = DEFAULT_ROOT,
    host: str = DEFAULT_HOST,
) -> ThreadingHTTPServer:
    resolved_root = root.expanduser().resolve()
    if not resolved_root.is_dir():
        raise ValueError(f"Server root is not a directory: {resolved_root}")

    handler = partial(SimpleHTTPRequestHandler, directory=str(resolved_root))
    return ThreadingHTTPServer((host, port), handler)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the DITHER repository with a local static HTTP server."
    )
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        default=DEFAULT_PORT,
        help=f"Local port. Defaults to {DEFAULT_PORT}.",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"Bind address. Defaults to {DEFAULT_HOST}.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="Directory to serve. Defaults to the repository root.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    server = create_server(port=args.port, root=args.root, host=args.host)
    root = args.root.expanduser().resolve()
    print(f"Serving {root} at http://{args.host}:{args.port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
