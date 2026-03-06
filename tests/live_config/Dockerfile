FROM astral/uv:python3.12-bookworm-slim

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:${PATH}"

RUN mkdir -p /opt/venv /root/.cache/uv /tmp/live-config

WORKDIR /workspace

COPY tests/live_config/pyproject.toml /tmp/live-config/pyproject.toml
COPY tests/live_config/uv.lock /tmp/live-config/uv.lock

RUN uv sync --project /tmp/live-config --locked
