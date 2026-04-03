"""Server runner for Bigraph Loom."""

from __future__ import annotations

import json
from pathlib import Path

import uvicorn

from bigraph_loom.api import app, load_bigraph, set_core
from bigraph_loom.session import sessions

DOCS_DIR = Path(__file__).parent.parent / "docs"


def _load_examples() -> None:
    """Load all .pbg files from the docs/ directory as examples."""
    if not DOCS_DIR.is_dir():
        return
    for pbg_file in sorted(DOCS_DIR.glob("*.pbg")):
        try:
            data = json.loads(pbg_file.read_text())
            state = data.get("state", data)
            schema = data.get("schema", None)
            view_state = data.get("view_state", None)
            name = pbg_file.stem
            sessions.add_example(name, state, schema, view_state)
        except Exception:
            pass  # skip invalid files


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
        state: Initial bigraph state dict. If None, loads ecoli_state example or starts empty.
        schema: Optional bigraph schema dict.
        core: A bigraph-schema Core with registered processes and types.
        host: Bind address.
        port: Bind port.
        open_browser: Whether to open the browser automatically.
    """
    if core is not None:
        set_core(core)

    # Load bundled examples
    _load_examples()

    if state:
        load_bigraph(state, schema)
    elif "cell_environment" in sessions.examples:
        # Default to ecoli_state if no state provided
        ex = sessions.examples["cell_environment"]
        load_bigraph(ex.state, ex.schema)

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
    """CLI entry point."""
    run_server()


if __name__ == "__main__":
    main()
