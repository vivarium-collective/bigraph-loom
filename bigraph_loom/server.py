"""Server runner for Bigraph Loom."""

from __future__ import annotations

import uvicorn

from bigraph_loom.api import app, load_bigraph, set_core


def run_server(
    state: dict | None = None,
    schema: dict | None = None,
    core: object | None = None,
    host: str = "127.0.0.1",
    port: int = 8891,
    open_browser: bool = True,
) -> None:
    """Start the Bigraph Loom server.

    Args:
        state: Initial bigraph state dict. If None, starts empty.
        schema: Optional bigraph schema dict.
        core: A bigraph-schema Core with registered processes and types.
        host: Bind address.
        port: Bind port.
        open_browser: Whether to open the browser automatically.
    """
    if core is not None:
        set_core(core)
    if state:
        load_bigraph(state, schema)

    if open_browser:
        import webbrowser
        import threading

        def _open():
            import time
            time.sleep(1)
            webbrowser.open(f"http://{host}:{port}")

        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(app, host=host, port=port)


def main() -> None:
    """CLI entry point — starts with an example bigraph."""
    from bigraph_loom.examples import EXAMPLE_CELL

    run_server(state=EXAMPLE_CELL)


if __name__ == "__main__":
    main()
