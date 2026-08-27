# Lampson in a container: the web UI on :8080, your project bind-mounted at /lampson/workspace.
#
#   docker build -t lampson .
#   docker run --rm -p 8080:8080 -v "$PWD:/lampson/workspace" -e LAMPSON_PROVIDER=deepseek -e LAMPSON_API_KEY=sk-... lampson
#
# Inside the container the `bash` tool is also confined by the container itself — the strongest setup.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git bash procps iproute2 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://synsema.com/install.sh | sh \
    && (ls /root/.local/bin/synsema /root/.synsema/bin/synsema /usr/local/bin/synsema 2>/dev/null | head -1 | xargs -I{} ln -sf {} /usr/local/bin/synsema) \
    && synsema --version
WORKDIR /lampson
COPY . /lampson
RUN mkdir -p /lampson/workspace /lampson/.lampson /lampson/memory && chmod +x lampson.sh lib/tools/*.sh
ENV LAMPSON_WORKSPACE=/lampson/workspace LAMPSON_SHELL=bash LAMPSON_PERMISSION=ask
EXPOSE 8080
CMD ["synsema", "serve", "web.syn"]
