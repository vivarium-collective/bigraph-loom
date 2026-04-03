"""Jupyter integration for Bigraph Loom."""

from __future__ import annotations

import threading
from typing import Any

from IPython.display import IFrame, display

from bigraph_loom.api import load_bigraph, set_core

_server_thread: threading.Thread | None = None
_server_port: int = 8891


def show(
    state: dict[str, Any],
    schema: dict[str, Any] | None = None,
    core: object | None = None,
    port: int = 8891,
    height: int = 600,
) -> None:
    """Display an interactive bigraph editor in a Jupyter notebook.

    Args:
        state: Bigraph state dict.
        schema: Optional bigraph schema.
        core: A bigraph-schema Core with registered processes and types.
        port: Server port.
        height: IFrame height in pixels.
    """
    global _server_thread, _server_port
    _server_port = port
    if core is not None:
        set_core(core)
    load_bigraph(state, schema)

    if _server_thread is None or not _server_thread.is_alive():
        _start_server(port)

    display(IFrame(src=f"http://127.0.0.1:{port}", width="100%", height=height))


def _start_server(port: int) -> None:
    global _server_thread
    import uvicorn
    from bigraph_loom.api import app

    def _run():
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

    _server_thread = threading.Thread(target=_run, daemon=True)
    _server_thread.start()
