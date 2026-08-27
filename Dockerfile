# Lampson in a container: the web UI on :8080, your project bind-mounted at /lampson/workspace.
#
#   docker build -t lampson .
#   docker run --rm -p 8080:8080 -v "$PWD:/lampson/workspace" -e LAMPSON_PROVIDER=deepseek -e LAMPSON_API_KEY=sk-... lampson
#
# Inside the container the `bash` tool is also confined by the container itself — the strongest setup.
# Base: ubuntu:24.04 because the synsema linux binary needs glibc >= 2.39.
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git bash procps iproute2 \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://synsema.com/install.sh | SYNSEMA_INSTALL_DIR=/usr/local/bin sh && synsema --version
WORKDIR /lampson
COPY . /lampson
RUN mkdir -p /lampson/workspace /lampson/.lampson /lampson/memory && chmod +x lampson.sh lib/tools/*.sh
ENV LAMPSON_WORKSPACE=/lampson/workspace LAMPSON_SHELL=bash LAMPSON_PERMISSION=ask
EXPOSE 8080
CMD ["synsema", "serve", "web.syn"]
