# The stede API (FastAPI), as run in production (see docs/deploy.md).
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1

# Dependencies first, so code changes don't reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project
COPY src ./src
RUN uv sync --locked

RUN useradd --system stede
USER stede
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "stede.main:app", "--host", "0.0.0.0", "--port", "8000"]
