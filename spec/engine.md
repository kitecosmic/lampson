# Lampson como motor (engine)

> Documento vivo. Es el norte del trabajo en `feat/engine` y lo que venga después (orquestación).
> Antes de cada sesión de trabajo: leer **Norte** y **Estado**. Al terminar: marcar el checklist y, si algo
> cambió de rumbo, anotarlo en **Bitácora** con fecha y motivo. Virar solo cuando haga falta, y siempre por escrito.

## Norte

Que Lampson se pueda usar **dentro de otras aplicaciones**, como motor: contestar los mensajes de un negocio
separando clientes, analizar una base de datos, ser el subagente de otro agente… sin la terminal ni la web
delante. Y que esa base sea la misma sobre la que después se construye la **orquestación de agentes**
(un equipo con roles —CEO, CTO, testing…— que se asignan trabajo, saben cuándo les toca y actúan solos).

**Objetivos**
- Un agente se define con **datos** (un archivo), no con código.
- Todo lo que entra es **un mensaje dirigido a un agente**: da igual si viene de la terminal, la web, la CLI,
  una API, un canal (WhatsApp, Slack…), una tarea programada u otro agente.
- Varias puertas (CLI, API HTTP, MCP, canales) con **un solo contrato** por debajo.
- Lo que hay hoy (terminal, web, subagentes, tareas programadas) **sigue funcionando igual** en cada paso.

**No-objetivos (por ahora)**
- **WASM / correr en el navegador.** Descartado (2026-10-16): no resuelve nada que no resuelva la API, pierde
  bash/archivos/plugins y la clave del modelo quedaría en el cliente. Se revisa solo si aparece un caso real
  (offline, edge).
- **Adaptadores por plataforma en el núcleo.** Lampson no sabe qué es WhatsApp ni Telegram (ver Canales).
- Multi-tenant con aislamiento entre organizaciones. Un proceso = un dueño. Para separar dueños se usan procesos
  separados.

## Arquitectura: 4 capas

```
┌──────────────────────────────────────────────────────────────┐
│ 4. PUERTAS    terminal · web · CLI run · API · MCP · canales │  traducen su entrada → sobre
├──────────────────────────────────────────────────────────────┤
│ 3. RUNTIME    deliver(sobre) → buzón del agente              │  sesiones (agente, thread)
│               despertadores: mensaje · cron · evento         │  aprobaciones · presupuestos
│               tablero compartido (tareas, quién toma qué)    │  bus de eventos
├──────────────────────────────────────────────────────────────┤
│ 2. AGENTES    *.agent.json: id, rol, prompt, tools,          │  datos, no código
│               permisos, modelo, presupuesto, a quién habla   │
├──────────────────────────────────────────────────────────────┤
│ 1. KERNEL     loop.run_turn(cfg, messages, opts, on_event)   │  ya existe (lib/loop.syn), no cambia
└──────────────────────────────────────────────────────────────┘
```

### Reglas que no se rompen

1. **Las puertas no llaman a `run_turn`.** Llaman a `runtime.deliver(sobre, hooks)`. El runtime elige el agente,
   carga la sesión, corre el turno, traza, guarda y devuelve el resultado. Una puerta que mantiene el historial en
   memoria (la terminal) usa el nivel de abajo, `runtime.turn(o, messages, label, hooks)`, que igual traza y
   guarda. Niveles en la cabecera de `lib/runtime.syn`.
2. **Una sesión es `(agente, thread)`.** El thread lo pone la puerta: el número de WhatsApp, el id de la sesión
   web, `cto:tarea-17`. Dos agentes hablando del mismo tema tienen historiales separados.
3. **Todo agente es un archivo.** Los perfiles que hoy están en el código (`build`, `plan`, `review`, `explore`,
   `worker`) son los agentes integrados. Un equipo es una carpeta de agentes.
4. **Todo evento lleva `agent` y `thread`.** Así cualquier puerta (y después el orquestador) sabe de quién es.
5. **Permisos y presupuesto son por agente.** Un agente sin humano delante nunca queda esperando una respuesta que
   no va a llegar: o tiene una regla, o abre una aprobación asíncrona.
6. **El kernel no se toca para agregar puertas.** Si una puerta necesita algo del kernel, va por `opts`/`on_event`.

## Casos de uso (para la documentación final)

Cómo se usa Lampson como motor, de lo más común a lo que viene. La documentación pública sale de acá.

1. **Atender clientes por chat** (WhatsApp, Instagram, email, web vía Chatwoot, o cualquier canal-plugin): un agente
   con el catálogo y las reglas del negocio, sesiones por cliente, ráfagas juntadas en una respuesta, permisos
   acotados (`strict`, rutas limitadas). → canales (fase 4), buzón.
2. **Integrarlo en tu app o backend**: `POST /v1/messages` (JSON, SSE o callback) con API key; o `lampson run` desde
   un script. → API (fase 2), `lampson run` (fase 1).
3. **Los empleados ya usan una IA** (Claude, ChatGPT, Cursor): el agente del negocio se conecta como tool MCP y le
   preguntan desde ahí, sin otra app, con la información y las reglas reales. → MCP HTTP (3b).
4. **Darle a una IA acceso a datos sensibles sin darle las llaves**: en el servidor, un agente de Lampson con un
   plugin de solo lectura y alcance limitado; la IA de afuera le pregunta y recibe solo la respuesta. → MCP, scopes.
5. **Ahorrar delegando lo pesado a un modelo barato**: Claude delega "lee estos 40 archivos" a un agente de Lampson
   con DeepSeek u Ollama y recibe el resumen. → MCP stdio (3).
6. **Agente ↔ agente entre empresas**: el agente de compras de un restaurante le pregunta precio y stock al agente
   del proveedor; cada uno con su Lampson, su key y sus reglas. Un Lampson pone la URL del otro en su `mcp.json` y
   su agente gana la tool `mcp_<proveedor>_ask`. → MCP HTTP servidor + cliente (3b). Es la base de la orquestación
   (fase 6): un equipo puede incluir agentes de afuera.

## Contratos

### Sobre (envelope)

Lo que entra al runtime, venga de donde venga.

```json
{
  "to": "soporte",                       // id del agente; vacío = el agente por defecto
  "thread": "whatsapp:+5491122334455",   // quién/qué conversación; vacío = thread nuevo
  "from": {"id": "+5491122334455", "name": "Ana", "kind": "human"},   // kind: human | agent | system
  "text": "¿tienen pan integral?",
  "images": [],                          // [{media_type, data(base64)}], igual que hoy en la web
  "channel": "whatsapp",                 // por dónde volver a responder; lo usa la puerta, no el agente
  "meta": {}                             // libre; viaja con el mensaje (trazas, ids externos)
}
```

Respuesta de `deliver`:

```json
{"agent": "soporte", "thread": "whatsapp:+5491122334455", "session": "<id de archivo>",
 "text": "Sí, a $1200.", "steps": 2, "usage": {"input": 0, "output": 0, "cached": 0}, "stopped": "done"}
```

### Agente (`*.agent.json`)

```json
{
  "id": "soporte",
  "description": "Atiende clientes de la panadería por chat",
  "role": "",                              // para la orquestación (fase 6); se ignora antes
  "base": "none",                          // "lampson": antepone el prompt del agente de código; "none": solo `system`
  "system": "Eres el asistente de Panadería Sol…",
  "tools": ["plugin_catalogo_buscar", "plugin_pedidos_crear"],   // allow-list exacta; mcp_*/plugin_* por nombre
  "permission": "strict",                  // ask | strict | yolo — modo por defecto de este agente
  "steps": 12,                             // tope de pasos por turno
  "budget_tokens": 60000,                  // tope de tokens por turno
  "model": {"provider": "", "model": ""}   // vacío = el configurado en lampson
}
```

Dónde se buscan, en orden (el último gana si se repite el id):
1. integrados: los perfiles de `lib/agents.syn` (`build`, `plan`, `review`, `explore`, `worker`)
2. del proyecto: `workspace/.lampson/agents/<id>.agent.json`
3. *(más adelante)* globales: `<LAMPSON_HOME>/agents/<id>.agent.json` — requiere sumar `agents` a los links del
   workspace (`lib/workspaces.syn` `LINKS`) y a `bin/lampson.js`.

### Eventos

Los mismos que hoy emite `run_turn` (`assistant`, `tool_call`, `tool_result`, `tool_denied`, `usage`, `inbox`,
`busy`, `idle`, `error`, `compact`) más los del runtime (`session`, `done`). En la CLI salen como JSONL:

```json
{"kind": "tool_call", "data": {...}, "tag": "", "agent": "soporte", "thread": "whatsapp:+54…"}
```

### Canales (fase 4)

Lampson define el sobre; **cada canal es un plugin** (cualquier lenguaje) que traduce su plataforma ↔ sobre.
- Núcleo: un solo canal, **`http`**: recibe el sobre por POST y responde (o reenvía a un webhook). Cubre a
  quien tiene su propia API, sin escribir nada.
- Ejemplo oficial: **Chatwoot** (ya unifica WhatsApp, Instagram, email, web).
- El resto (Telegram, Discord, Slack…) lo escribe quien lo necesite, o lo genera Lampson con `plugin action=create`.

## Fases

Cada fase deja todo funcionando y con tests. Una rama `feat/engine` mientras dure el motor (fases 1–5); la
orquestación va en su propia rama.

### Fase 1 — Runtime + agentes como archivos + `lampson run`
- [x] Spec (este archivo)
- [x] `lib/runtime.syn`: carga de agentes (integrados + proyecto), `boot` / `system_for` / `opts_for`,
      sesión por `(agente, thread)` (índice en `.lampson/threads/`), `open` / `turn` / `deliver`
- [x] Tests unitarios del runtime (validación de specs, carga, allow-list, boot, ids de sesión) — `unit.test.syn`
- [x] `run.syn` + `lampson run` en los launchers (ps1 y sh): `--agent`, `--thread`, `--session`, `--json`,
      mensaje por argumento o stdin; sin humano = `strict` salvo que el agente o el flag digan otra cosa
- [x] `run_test.syn` contra `tests/mock_llm.syn` (deliver en proceso + `run.syn` como proceso), en `tests/run.*`
- [x] `web.syn` (`POST /api/chat`) pasa por `runtime.deliver` (y `open`/`save` para `!comando`) — probado a mano
      contra el mock: sesión nueva, continuación, `!comando`, `worker` → `build`, traza
- [x] `chat.syn` pasa por el runtime (`system_for`, `opts_for`, `turn`, `save`); `/agent` ve los del proyecto —
      probado a mano por PTY contra el mock: turno con tool, `/agent plan`, segundo turno, traza sin duplicados
- [x] README / guide: "Use it from your app" y "Headless: `lampson run`"
- [ ] ~~Merge de `feat/engine` a `main` al cerrar la fase 1~~ → se mergea al final del motor (ver Estado)

**Pendientes que salieron en la fase 1** (no bloquean; se toman cuando toque):
- [x] **Alcance por ruta en el allow-list, opcional** (visto 2026-10-16 con el agente `tienda` de prueba):
      `"tools": ["read"]` sigue siendo todo el workspace (código, uso personal); `{"name": "read", "paths":
      [".lampson/tienda/*"]}` lo limita. `lib/scope.syn`, lo hace cumplir `loop.execute` con la ruta real (`c.ws`).
      Solo read/write/edit/ls/find/grep; con tools limitadas no se permiten bash/process/delegate/lsp/computer_use
      (leerían cualquier archivo por otro camino). Probado con el modelo real: un agente "ingenuo" pidió `.env.prueba`
      → denegado por alcance.
- [x] En la terminal, un agente del proyecto con `model` propio usa igual el modelo configurado (`chat.syn` tiene
      su `cfg` global para `/model`). Web y `lampson run` sí lo respetan.
      → hecho: `chat.syn` usa el modelo del agente al arrancar y con `/agent` (`/model` lo cambia para la sesión); probado por PTY.
- [x] Agentes globales (`<LAMPSON_HOME>/agents/`): sumar `agents` a `LINKS` de `lib/workspaces.syn` y a `bin/lampson.js`.
      → hecho: `agents/` de la instalación, enlazada en cada workspace; el del proyecto pisa al global. Test unitario + por la API (worker del buzón).
- [x] Test automático de `POST /api/chat` (hoy solo hay prueba manual; `web_test.syn` es una copia local vieja).
      → cubierto por `api_test.syn` (web.syn real): la UI usa las mismas piezas que /v1.
- [x] `lampson run --stdio`: un proceso que queda abierto, un sobre JSON por línea de stdin → eventos JSONL
      (base del SDK de la fase 5).
      → hecho (fase 5), con conversaciones en paralelo (protocolo 2).

### Fase 2 — API HTTP + canal `http`
Rutas en `web.syn` (bajo `/w/<slug>/v1`, el hub las reenvía sin passkey), lógica en `lib/api.syn`, keys en
`lib/apikeys.syn`:
- [x] `POST /v1/messages` con el **sobre en el body** → JSON con el resultado
- [x] `POST /v1/messages/stream` → SSE con los mismos eventos que `lampson run --json`
- [x] `GET /v1/agents` (los que la key puede usar) · `GET /v1/jobs/<id>`
- [x] API keys por agente (`lampson key add [--agent ID[,ID]] [--name N]` · `key list` · `key remove <id>`); solo
      el hash, en el estado del workspace (`.lampson/api_keys.json` del ws, nunca en el proyecto); siempre
      obligatorias, también por loopback
- [x] Canal `http`: `"callback": "https://…"` → 202 `{job}` enseguida, el turno corre en un `agent` (ApiJob) y el
      resultado va por POST al callback (2 intentos, firmado con `LAMPSON_WEBHOOK_SECRET` como las aprobaciones)
- [x] Aprobaciones: en modo `ask` la API usa la cola de `lib/approvals.syn` (UI, link firmado, terminal); vence →
      denegado. Sin modo en el agente → `strict`
- [x] Un workspace con API keys cuenta como "en uso" para la política `auto` del hub (si no, el próximo mensaje
      de un bot encontraba el workspace apagado → 502)
- [x] `api_test.syn` contra `web.syn` real en :47990 (26 checks: auth, JSON, 403/404/400, SSE, callback firmado,
      jobs, revocar) — y a mano por el hub con el modelo real (agente `tienda`, JSON + SSE + callback)

**Pendientes que salieron en la fase 2:**
- [x] **Buzón por conversación** (`lib/mailbox.syn`): antes, tres mensajes seguidos del mismo cliente corrían en
      paralelo sobre la misma sesión (el último en guardar pisaba a los otros) y salían tres respuestas sueltas.
      1. **Fila por `(agente, thread)`, siempre**: nunca dos turnos a la vez sobre la misma conversación.
      2. **Espera de silencio**: el turno arranca tras `quiet_s` sin mensajes nuevos o al cumplirse `max_s` desde el
         primero; la ráfaga va en UN turno, ordenada por `sent_at` (hora del cliente, si el canal la da) o llegada.
         Por agente: `"buffer": {"quiet_s": 3, "max_s": 15}` (default de la API) o `"buffer": false`.
      3. **A mitad de turno**: lo que llega mientras el agente trabaja entra por `opts.inbox_fn` antes de la próxima
         llamada al modelo.
      Todos los mensajes del lote reciben la misma respuesta (`batch`, `lead`); con callback, UN POST por lote y
      URL, y los demás jobs quedan `merged`. Probado en `api_test.syn` (ráfaga desordenada, mitad de turno,
      clientes en paralelo, callback) y con el modelo real: "hola" / "¿precio del pan sin gluten?" / "¿hay stock?"
      a 0,1 / 1,3 / 3,0 s → un lote, una respuesta con precio y stock.
- [x] Rate limit por key (`rate_limit` de Synsema en las rutas `/v1`, o propio por key).
      → hecho: `rate` por key (120/min por defecto, 0 = sin límite) → 429 + Retry-After; `lampson key add --rate N`.
- [x] Probar el modo `ask` por la API con una aprobación real (el código reusa la cola; no tiene test propio).
      → hecho: `api_test.syn` deniega y aprueba por la cola (`riesgo-suave` del mock); la cola registra denied/approved.
- [x] Las keys solo se ven por la CLI: falta panel en la web (va con la documentación, al final).
      → hecho: panel «API» en la web (crear, ver la key una vez con las URLs, revocar).
- [x] Callback a una URL arbitraria: quien tiene una key puede hacer que Lampson haga POST a cualquier lado
      (incluida la red local). Aceptable porque la key es de confianza; evaluar una allow-list por key.
      → hecho: `callbacks` por key (prefijos permitidos) → 403 fuera de la lista; `lampson key add --callback URL`.

### Fase 3 — `lampson mcp serve`
- [x] Lampson como servidor MCP por stdio (`lib/mcp_server.syn`, dentro de `run.syn` con `LAMPSON_MCP_SERVE=1`):
      `lampson mcp serve [--agent ID[,ID]] [--workspace RUTA]`. Tools `ask(message, agent?, thread?)` y `agents()`.
      Sin thread, `ask` crea uno (`mcp:…`) y lo devuelve en el texto y en `structuredContent` para continuar. Con un
      solo agente ofrecido, `ask` no pide `agent`. Sin humano → `strict` salvo que el agente diga otra cosa.
- [x] Test en `run_test.syn` (JSON-RPC por stdin como un cliente real: initialize, tools/list, ask, continuación por
      thread, agente no ofrecido, método desconocido) y a mano por el launcher en `e-commerce` con el modelo real:
      stdout solo JSON-RPC, stderr vacío.

**Pendientes que salieron en la fase 3:**
- [x] `threads(agent)` / historial de una conversación (se dejó fuera: el cliente ya guarda su thread).
      → hecho: tool `history(thread, agent?, limit?)` (stdio y HTTP).
- [ ] Los requests se atienden de a uno (un `ask` largo demora al siguiente); el cliente MCP típico espera igual.
- [x] Notificaciones de progreso (`notifications/progress`) mientras el agente trabaja.
      → hecho: `POST /v1/mcp/stream` (SSE) con `progressToken`.
- [ ] Ejemplo de configuración para Claude Desktop / Cursor (va con la documentación final; en Windows el comando
      es `lampson.cmd`).

### Fase 3b — MCP por HTTP (y Lampson como cliente MCP por HTTP)
- [x] Servidor: `POST /w/<slug>/v1/mcp` ("Streamable HTTP" de MCP, respuestas JSON; notificación → 202; GET → 405),
      con la API key de `/v1` (cada key ve solo sus agentes). Mismo manejo que stdio (`mcp_server.handle`). Los
      `ask` pasan por el buzón (dos agentes de afuera en la misma conversación no se pisan); entre agentes no hay
      espera de silencio salvo que el agente la configure. Negocia la versión de protocolo que pide el cliente.
- [x] La URL pública que Lampson ya sabe tener (`--domain`, túnel, `LAMPSON_PUBLIC_URL`) completa esto:
      `lampson key add` imprime la URL de la API y la del MCP listas para pegar en otra app o agente.
- [x] Cliente: `lib/mcp.syn` también habla HTTP. En `mcp.json`, el formato de Claude Code:
      `{"proveedor": {"url": "https://…/v1/mcp", "headers": {"Authorization": "Bearer ${LAMPSON_PROVEEDOR_KEY}"}}}`
      (`${LAMPSON_*}` se expande del `.env`: la key no queda escrita). Respuestas JSON o SSE, `Mcp-Session-Id`.
      `/mcp add <nombre> https://…` también sirve.
- [x] Tests (`api_test.syn`): servidor (401, initialize, 202, tools/list por key, ask + continuación, 405) y
      **agente ↔ agente**: un `lampson run` con un `mcp.json` que apunta a otro Lampson usa a su agente como tool
      (`mcp_proveedor_ask`) y responde con lo que le contestó. A mano por el hub con el modelo real: un "agente de
      compras de un restaurante" le pidió 10 panes integrales al agente `tienda` → stock, precio con promo y envío.

**Pendientes que salieron en la fase 3b:**
- [x] **Permiso por tool en el agente** (así nadie está obligado a dar `yolo` para todo): en el allow-list,
      `{"name": "mcp_proveedor_*", "approve": "auto"}` → esa tool (o ese prefijo) se evalúa como en yolo, SOLO ella
      (lo prohibido en todos los modos sigue prohibido); `{"name": "bash", "approve": "ask"}` → pide aprobación
      siempre, aunque el agente sea yolo. Combina con `paths`. Lo aplica `loop.execute` (`approve_for`). Probado:
      unitarios, `ask` sin humano → denegado, y agente ↔ agente con el agente A en `strict` + `approve: auto` (y el
      mismo agente sin `approve` → denegado).
- [x] Respuestas en streaming (SSE) desde nuestro servidor MCP y progreso mientras el agente trabaja.
      → hecho: `/v1/mcp/stream` (ruta aparte: en Synsema un `stream` dentro de un `when` no transmite).
- [x] `tty_test` intermitente (~1 de cada 20-25 corridas): la vez que se pudo ver, quedó colgado después del paso
      Esc, antes de `/exit` (que mide 0,1 s; ese camino no cambió). Parece del manejo de la PTY bajo carga, no del
      motor. Si se vuelve frecuente: timeout propio por paso y volcar la pantalla al fallar.
      → mitigado: cada paso final espera hasta ver lo que busca (tope 10 s) y muestra la pantalla si falla; 8/8 corridas.

### Fase 4 — Canales como plugins
Contrato en la cabecera de `lib/channels.syn`. Universal a propósito: cada uno arma el canal que necesite, la
comunidad suma los suyos, y nosotros vamos publicando uno cada tanto para cubrir más plataformas.
- [x] Plugin con `"channel": {"agent": "<id>"}` en `plugin.json` (puede no tener tools). Dos acciones, cualquier
      lenguaje: `receive` (webhook crudo → `{"messages": [...], "http"?}`) y `send` (respuesta → plataforma).
- [x] `"config": ["X", …]` en cualquier plugin: el hijo recibe `PLUGIN_X` = `LAMPSON_X` del `.env` (secretos y
      ajustes, también para plugins Synsema con techo `env=PLUGIN_*`).
- [x] Webhook: `POST|GET /w/<slug>/ch/<canal>` (el hub lo reenvía sin passkey; la firma la verifica el plugin, que
      recibe el body exacto). Se contesta enseguida; los mensajes van al buzón (fila, espera, mitad de turno) con
      thread `<canal>:<thread>`; UNA respuesta por lote vía `send`. Agente: el del mensaje →
      `LAMPSON_CHANNEL_<CANAL>_AGENT` → `channel.agent` → el por defecto. Log: `.lampson/channels/<canal>.log`.
- [x] Oficial: **Chatwoot** (`plugins/chatwoot`, Synsema con techo `net`): verifica `X-Chatwoot-Signature`
      (HMAC de `"{timestamp}.{body}"`, 5 min contra replays), solo mensajes entrantes y públicos (los salientes —
      incluidas las respuestas del propio agente — se ignoran: sin eso el bot se contestaría a sí mismo), adjuntos
      como links, responde por `POST /api/v1/accounts/<a>/conversations/<display_id>/messages`.
- [x] Tests: `api_test.syn` de punta a punta contra un Chatwoot simulado (ráfaga firmada → un envío, firma inválida
      y sin firma → 401, saliente ignorado, log); unitarios del manifiesto y del contrato.

**Pendientes que salieron en la fase 4:**
- [ ] **(después, decidido por Joel)** Probar `plugins/chatwoot` contra un Chatwoot real (formato verificado con la doc oficial; `message_type`
      llega como texto o número según la versión, cubierto).
- [x] Imágenes entrantes: hoy van como link en el texto; pasarlas como imagen si el modelo tiene visión.
      → hecho: Telegram (getFile, la más grande ≤ 1 MB) y Chatwoot (adjuntos imagen ≤ 1,5 MB) las pasan como imagen.
- [x] Indicador de "escribiendo…" mientras el agente trabaja (acción opcional `typing` del canal).
      → hecho: acción opcional `typing` (`"channel": {"typing": true}`), el worker la renueva cada ~4,5 s.
- [x] Panel de canales en la web (encender, ver el log, la URL del webhook) — con la documentación final.
      → hecho: panel «Canales» (encender, modo, agente, URL, configurar, últimos eventos).
- [x] **Telegram** (`plugins/telegram`, Synsema con techo `net`), para quien no usa Chatwoot: gratis, sin
      intermediarios. Verifica `X-Telegram-Bot-Api-Secret-Token`; solo mensajes nuevos de personas (ignora
      ediciones, posts de canal y otros bots); foto/audio/archivo/ubicación como nota en el texto (con el caption);
      "escribiendo…" (`sendChatAction`) apenas llega el mensaje; respuestas en partes de ≤ 4000 caracteres cortando
      en saltos de línea, texto plano. Config: `LAMPSON_TELEGRAM_TOKEN`, `_WEBHOOK_SECRET`, `_API` (opcional).
- [x] Acción opcional **`setup`** en el contrato de canales + CLI: `lampson channel list` (canales, encendido,
      agente, URL del webhook) · `lampson channel on|off <canal>` · `lampson channel setup <canal>` (registra el
      webhook con la URL pública; Telegram → `setWebhook` con el secreto). Un canal sin `setup` (Chatwoot) muestra la
      URL para pegarla en la plataforma.
- [x] Tests (`api_test.syn`) contra una Bot API simulada: list, setup (URL pública + secreto + token), ráfaga → una
      respuesta, escribiendo…, secreto inválido → 401, edición y bot ignorados, foto con caption, partes de ≤ 4000.
- [x] Probar `plugins/telegram` con un bot real (hace falta un token de @BotFather y la URL pública por https).
      → hecho con @lampson_bot: primero por relay y después en **modo sin URL pública** (poll) nativo. Falta el modo webhook real (necesita dominio o túnel).
- [x] **Canales sin URL pública** (modo poll): acción opcional `poll` (`"channel": {"poll": true}`); `lampson channel
      setup` lo elige solo si no hay URL pública; un agente por canal en el proceso del workspace, cursor en disco.
      Telegram con getUpdates. Probado en `api_test.syn` y con @lampson_bot real.
- [ ] Próximos canales oficiales: WhatsApp Cloud API directo, Slack, Discord.

### Fase 5a — OpenAPI de la API pública (lo que destraba todos los lenguajes)
- [x] Solo se publica la API `/v1` (6 operaciones: messages, messages/stream, agents, jobs/{id}, mcp POST/GET): las
      64 rutas internas de `web.syn` (UI `/api/*`, terminal, aprobaciones, webhooks `/ch/*`) llevan `private` al
      inicio del cuerpo — se siguen sirviendo, pero quedan fuera de `/openapi.json`, `/llms.txt`, `/docs` y la agent
      card. El hub entero es `private` (verificado en vivo: los documentos dan 404; ojo, la CLI `synsema openapi`
      ignora el `private` del bloque serve, el servidor no).
- [x] `describe` con título, versión de la API (1.0.0) y una descripción por operación; `requires auth` en `/v1`
      → el documento declara Bearer; `expect body` → requestBody (`text` en messages, `jsonrpc`+`method` en mcp).
- [x] `GET /w/<slug>/v1/openapi.json`: el documento por la ruta que el hub sí reenvía.
- [x] Seguridad: `check_client` acepta una API key (`lk_…`) **solo** en rutas `/v1/…` — si no, una key de la API
      abriría la UI, el chat con tools y la terminal en un Lampson sin hub (Docker). La verificación por ruta
      (`api.authorize`) sigue: por loopback tampoco entra nadie sin key.
- [x] Test (`api_test.syn`): el documento por `/v1/openapi.json` y por la raíz solo trae `/v1`, con auth y body;
      `/llms.txt` no lista la UI, la terminal ni los webhooks.
- [ ] `expect body` solo expresa campos obligatorios: los opcionales del sobre (`to`, `thread`, `callback`…) van en
      la descripción. Un generador de clientes ve solo `text`; los SDK escritos a mano (5b) los tipan todos.

### Fase 5 — SDK
Dos modos, los mismos métodos (`ask`, `stream`, `agents`, `job`, `close`, `verifySignature`):
**servidor** (HTTP `/v1` con URL + key) y **local** (el SDK arranca Lampson como proceso hijo y le habla por
`lampson run --stdio`: sin hub, sin puerto, sin key — Lampson adentro de tu programa, como SQLite).
- [x] `lampson run --stdio` (en `run.syn`): un proceso abierto, un pedido JSON por línea (`ask`/`agents`/`ping`, con
      `id`), los mismos eventos que `--json` con ese id, `done` al cerrar cada ask, `ready` al arrancar. En orden,
      de a uno. Probado en `run_test.syn` (pedidos encadenados, ids, continuación, errores sin morir).
- [x] `prepare` en `cli.syn`: `run`, `--stdio`, `key`, `channel` y `mcp serve` preparan solo la carpeta del
      workspace — ya no arrancan el hub ni el proceso web (antes `lampson run` pasaba por `ensure`).
- [x] **JavaScript/TypeScript** en el paquete npm actual (`sdk/index.js` + `index.mjs` + `index.d.ts`, sin
      dependencias, Node 18+): `require("lampson")` e `import { Lampson } from "lampson"`. El modo local lanza el
      launcher del propio paquete (no depende del PATH). `tests/sdk_test.mjs`: los dos modos, 21 checks.
- [x] **Python** (`sdk/python`, stdlib, 3.9+, síncrono, context manager): `from lampson import Lampson`. El modo
      local usa el comando `lampson` instalado. `tests/sdk_test.py`: los dos modos.
- [x] A mano, modo local real (por el launcher, con el modelo de Joel, en `e-commerce`): JS y Python arrancan
      Lampson en ~4-5 s y el agente `tienda` responde; el hub no se toca.
- [x] **npm: publicado `lampson@0.3.0`** (2026-10-16, tag `v0.3.0` desde `feat/engine`, con procedencia firmada):
      `npm i lampson` trae el CLI y el SDK (`require` e `import` verificados en una carpeta limpia).
- [ ] PyPI (`sdk/python`: paquete armado, `twine check` PASSED, el nombre `lampson` está libre; lo sube Joel).
- [x] Modo local: los pedidos se atienden de a uno; varias conversaciones en paralelo necesitarían varios procesos o
      un `--stdio` concurrente.
      → hecho: protocolo 2, un agente por ask; misma conversación en fila, distintas en paralelo (6 s en vez de 12).
- [ ] Otros lenguajes: generar clientes desde `/v1/openapi.json` (5a); PHP a mano si hay demanda.

### Fase 6 — Equipos de agentes (rama `feat/teams`, desde `main` @ cdcd54d)

Vocabulario fijado por Joel (2026-10-16) — vale para archivos, API, interfaz y documentación:

| concepto | nombre | |
|---|---|---|
| un agente (`*.agent.json`) | **agente** | el mismo término de cara al usuario; nada de «asistentes» ni «empleados» |
| el grupo que coordina | **equipo** (`team`) | `.lampson/teams/<id>.team.json` |
| lo que hace cada uno en el equipo | **rol** | texto libre: ventas, soporte, CEO… |
| la lista compartida de trabajo | **tablero** (`board`) con **tareas** | dueño, estado, dependencias |
| cuándo un agente trabaja solo | **ronda** | mira si hay algo para él; sin trabajo, no gasta |
| de un agente a otro | **mensaje** (tool `send`) | entra por el buzón, como un cliente |
| lo que le pedís a un agente o a un equipo | **objetivo** | «reservame…», «buscá el precio más barato…», «agregá tal feature» |

**Dos superficies, un motor** (decidido con Joel, 2026-10-16):

- **Objetivos** — le pedís algo a un agente y trabaja solo hasta terminarlo: arma su plan como tareas en el tablero,
  avanza en rondas, cuenta en qué está, deja el resultado, y pide aprobación (celular) antes de cualquier acción hacia
  afuera (reservar, comprar, mandar, mergear). Un objetivo es un equipo de un agente.
- **Equipos** — un lienzo (grafo) en la web: nodos = agentes con puesto, personalidad, modelo, tools y permisos;
  flechas = a quién reporta / a quién puede escribir. Al lado, el tablero y la actividad en vivo. Sirve para algo chico
  (ventas + soporte) y para una empresa (CEO, CTO, CPO, CMO, dev) sobre un repo: cada agente en su rama (worktree) y con
  su nombre de autor; la persona aprueba lo que llega a `main`.
- Web: una sección nueva con dos pestañas, **Objetivos** y **Equipos**.

**Orden** (Joel): primero el motor común, después **Objetivos**, después **Equipos**. **Escenario de prueba real:**
una empresa sobre un repo de prueba — primero el objetivo de un solo agente (el CTO recibe «agregá tal feature»,
planifica, trabaja en su rama en rondas y pide aprobación para mergear); después el equipo completo sobre el mismo
repo (CEO reparte, CPO define, dev implementa, CTO revisa, CMO escribe el anuncio).

#### 6a — Motor común
- [x] Tool `send(recipient, message)` entre agentes → base → `lib/teamrun.syn` (tick cada 3 s) → buzón del destinatario, thread `team:<id>`; el grafo del equipo decide quién le escribe a quién (jefe ↔ reporte + `talks`), lo demás se rechaza
- [x] Tablero: tareas {id, título, dueño, estado, depende de, notas} en SQLite (`.lampson/teams.db`), tool `board`
      (list/add/claim/update/show/log); tomar es atómico; mueve el dueño, quien la creó o un jefe del dueño
- [x] Registro (ledger) de todo; cada turno de equipo arranca con «desde tu último turno» + sus tareas + las sin dueño
- [ ] Eventos por el bus para la web (con la pantalla)
- [x] Rondas por agente (`round_minutes` del equipo): solo con trabajo (novedades de otros o tareas suyas abiertas),
      una por intervalo; el hub mantiene vivo un workspace con equipos que hacen rondas
- [ ] Repaso barato con `judge` antes de un turno completo (si las rondas resultan caras en la prueba real)
- [x] Presupuesto diario por agente dentro del equipo (`budget_daily_tokens`); al llegar no recibe turnos y queda una
      entrada en el registro por día
- [x] Aprobaciones: las del buzón de siempre (cola de aprobación → UI / celular), con el permiso del archivo del agente

#### 6b — Objetivos
- [x] Objetivo = {id, texto, agente, estado, informe, pregunta, resultado, turnos, gasto, presupuesto} en la tabla
      `objectives`; conversación y tablero propios (`objective:<id>`); tool `objective` (report, ask, request_approval,
      done, fail); el pulso da un turno al terminar el anterior + `round_seconds`; esperando no gasta; sin presupuesto
      se pausa y «seguir» da otro tramo. API `/v1/objectives` (crear, listar, ver, responder/aprobar, cancelar) y
      la privada de la pantalla. CLI: pendiente
- [x] Pantalla propia `/w/<slug>/equipos` (public/teams.html, css/teams.css, js/teams.js), a pantalla completa, con
      enlace «equipos» desde la cabecera: pestaña **Objetivos** (lista, nuevo, detalle con tablero kanban, informe,
      resultado, cancelar; registro en vivo) y franja fija de lo que espera a la persona (aprobar / denegar /
      responder); pestaña **Equipos** con el grafo (quién reporta a quién, quién también se habla, quién trabaja
      ahora, flechas que se encienden con cada mensaje), tablero y registro. Se actualiza cada 2,5 s
- [x] Repo de prueba `Desktop/proyectos/empresa-demo` (API de tareas en Node, `npm test`). Corrida real con
      glm-5.3-flash: el CTO planificó 4 tareas, creó `cto/filtro-estado`, implementó `?done=true|false` con 2 tests,
      commiteó como «CTO (Lampson)» y pidió aprobación (1 turno, 12 pasos); aprobado por la API, mergeó a main con
      `--no-ff` y terminó con el resultado (2.º turno, 3 pasos). 25,6k tokens de costo. 5/5 tests en main.
      Pendiente de 6c: el commit de merge quedó con el autor del repo, no el del agente
- [ ] Documentación (en/es/pt) con la corrida real

#### 6c — Equipos
- [ ] `.lampson/teams/<id>.team.json`: agentes, roles, personalidad, quién reporta a quién, quién escribe a quién
- [ ] Ramas por agente (git worktree) y autor por agente en los commits; merge a `main` con aprobación
- [ ] Pestaña **Equipos**: lienzo para crear y editar (nodos y flechas), tablero y actividad en vivo
- [ ] Escenario real: la empresa completa sobre el repo de prueba
- [ ] Documentación (en/es/pt) con la corrida real

## Estado

**Documentación pública** (2026-10-16): lampson-site, rama `docs/engine` — grupo «Lampson como motor» (engine,
agents, headless, api, channels, mcp-server, sdk) en en/es/pt, más MCP, plugins, comandos, configuración, interfaz
web, FAQ, portada y llms.txt actualizados; 0 enlaces rotos en los tres idiomas. `main` de Lampson ya tiene el motor
(merge 2026-10-16) y npm 0.3.0 / PyPI 0.3.0 están publicados.

**Pedidos de punta a punta** (2026-10-16, rama `feat/orders`): plugin `orders` oficial + instrucciones de plugin +
dos arreglos del buzón que salieron de la prueba real. Documentado en lampson-site (`docs/*/orders.md`, sección
«Instrucciones» de plugins). Telegram en modo webhook real por el túnel `https://7qsh3d-tunnel.synsema.app`
(`syn tunnel … --service`); el hub arranca al iniciar sesión (`lampson --install`, carpeta Inicio).

**Fase actual:** motor completo (fases 1-5) y los pendientes cerrados, salvo los que necesitan algo de afuera
(Chatwoot real, webhook real de Telegram con dominio/túnel, publicar en PyPI/npm) y los próximos canales. Siguiente:
Joel verifica → documentación final → merge a `main`; después fase 6 (orquestación) en su propia rama. **Rama:** `feat/engine` (desde `main` @ 61fae00).
**Sin merge a `main` hasta terminar y probar todo el motor** (decisión de Joel, 2026-10-16): por ahora solo nosotros
sabemos que existe. **Documentación pública al final**, con todo probado; mientras tanto el detalle vive acá.

## Ramas

- `main`: lo publicado. Se llega por merge de las otras.
- `fix`: arreglos chicos. Al terminar una tanda: merge a `main` y `fix` se adelanta a `main` (fast-forward).
- `feat/<tema>`: trabajo grande (`feat/engine`, después `feat/orchestration`). Se mergea a `main` al cerrar
  una fase que deja todo funcionando; si `main` avanzó (por `fix`), se trae `main` a la rama antes.

## Bitácora

Decisiones y cambios de rumbo, lo más nuevo arriba.

- **2026-10-16** — 6b (Objetivos) andando de punta a punta con un modelo real (ver la fase 6b). Decisiones: un
  objetivo es un equipo de un agente — misma base, mismo registro y mismo tablero, con scope `objective:<id>`; el
  agente lo trabaja en su propia conversación y la tool `objective` es su único canal con la persona (informar,
  preguntar, pedir aprobación, terminar). Aprobar algo irreversible es una REGLA del texto del objetivo y de la tool
  (la aplicación dura de «no mergear sin aprobación» llega con las ramas por agente de 6c). Bug encontrado: el buzón
  recibía `buffer: false` y su worker moría en silencio, dejando la conversación trabada para siempre; ahora
  `mailbox.submit` normaliza el valor. La pantalla es una página aparte (no un panel), como pidió Joel.

- **2026-10-16** — 6a (motor común de equipos) hecho. `lib/teams.syn` (archivo de equipo, grafo, SQLite con tareas,
  registro, mensajes, cursores, rondas, gasto; tools `send` y `board`) + `lib/teamrun.syn` (el pulso: entrega y
  rondas por el buzón). Decisiones: una conversación por agente y equipo (`team:<id>`) en lugar de una por par —
  el agente tiene todo su trabajo en un solo hilo; su respuesta final no la ve nadie (para hablar, `send`; para
  avanzar, el tablero). Los miembros de un equipo reciben `send`/`board` solos y su rol va al prompt. Quién llama lo
  pone el loop (`opts.agent_id` → `_agent`), el modelo no puede elegirlo (probado: un `_agent` falso se pisa).
  `call_tool` pasa los args como parámetros con nombre: `to` es palabra reservada y `text` un builtin, por eso los
  parámetros son `recipient`/`message`.

- **2026-10-16** — Arranca la fase 6 en `feat/teams`. Nombres: agente, equipo, rol, tablero/tareas, ronda, mensaje
  (tabla en la fase 6). «Agente» también de cara al usuario: un solo término en archivos, API, interfaz y docs.

- **2026-10-16** — **Pedidos por chat de punta a punta, probado con una conversación real** (modelo `glm-5.3-flash`,
  cliente escribiendo en ráfagas con pausas de 2 a 6 s, por `/v1/messages` a través del hub — el mismo buzón que
  Telegram). Cuatro conversaciones: Martín (pan blanco sin stock → alternativa, cotización con promo y pack, se
  acerca al envío gratis y suma alfajores, dirección en cuatro mensajes, confirma → P-0001; después agrega una torta
  para mañana 8 h → P-0002 con `when` y nota), un pedido de backend sin humano (P-0003), Ana que vuelve y pide «lo
  mismo» con su teléfono (`find_customer` → P-0004). Totales todos correctos, stock descontado.
  - **Instrucciones de plugin** (`plugin.json` `"instructions"`: texto o un `.md`; sin el campo, `INSTRUCTIONS.md`):
    se suman al system de cada agente que tiene alguna de sus tools (`runtime.system_for` →
    `plugins.instructions(catálogo del agente)`), integrados incluidos. Genérico a propósito (Joel): un proceso de
    backend, «lee el skill X», un prompt largo, recomendar otras tools/MCP/plugins — no solo chat. El agente
    `tienda` quedó con solo su personalidad; el proceso de pedidos lo trae el plugin.
  - **Plugin `orders`** (syn, techo `file=workspace/.lampson/orders/*`): catalog, quote, place_order, find_customer,
    order_status. Las cuentas las hace el plugin (pack, segunda a mitad, envío gratis desde), `place_order`
    recalcula, valida pago/dirección/stock, guarda `P-NNNN.json`, baja stock, guarda clientes por teléfono o nombre.
    Visto en la traza: el modelo inventó SKUs al repetir un pedido → `quote` devuelve `valid_skus` y `find_customer`
    trae los sku de cada línea.
  - **Buzón: respuesta vieja** — con pausas de 4 s salió «pasame tu nombre» cuando el nombre ya había llegado: el
    mensaje entró mientras el modelo escribía la respuesta final (sin tools), y el loop solo miraba el buzón antes
    de cada llamada. Ahora `opts.inbox_final` (lo pone el buzón): si al terminar hay mensajes nuevos, se descarta el
    borrador, entran los mensajes y se responde de nuevo. En la sesión queda solo la respuesta final.
  - **Hub: 504 a los 30 s** en `POST /v1/messages` síncrono (el proxy corta por defecto): las rutas `/v1` del hub
    llevan `timeout 600`.
  - Pendiente posible: modificar/cancelar un pedido confirmado (hoy el agente arma uno nuevo); el alias de pago va
    en `policies` del catálogo.

- **2026-10-16** — El buzón va en el **runtime**, no en cada canal: lo aprovechan la API, cualquier canal-plugin y
  después los agentes que se mandan mensajes (fase 6), y nadie que escriba un canal tiene que reimplementarlo. La
  fila no es opcional (es corrección); la espera sí (`buffer`). Mecánica: estado de `serve` (`state_*`) con un lock
  por conteo (`state_incr`), un worker por conversación (`agent MailboxWorker`) que se va cuando la fila queda
  vacía (tomar y soltar bajo el mismo lock: ningún mensaje queda huérfano), eventos por el bus para el SSE. El
  `agent ApiJob` de la fase 2 desapareció: los callbacks los entrega el worker. Bajo `lampson run` no hay fila
  (cada proceso es un mensaje); la terminal y el chat web tampoco la usan (la persona está mirando).

- **2026-10-16** — Fase 2 hecha. Decisiones del camino:
  - El sobre va en el **body** (`POST /v1/messages`), no en la URL (`/agents/:a/threads/:t/…`): un thread como
    `whatsapp:+54911…` en una URL obliga a codificarlo, y el body ya es el contrato del sobre.
  - El streaming es otra ruta (`/v1/messages/stream`) y no un flag: `stream` en Synsema es un bloque de la ruta.
  - La API exige key **siempre**: bajo el hub todo llega por loopback y `check_client` lo daría por bueno.
  - `lampson.ps1` corre dentro de la sesión de PowerShell del usuario: las variables de `run`/`key` se borran al
    terminar (un `LAMPSON_SESSION` que quedaba hacía que el siguiente `lampson` retomara esa sesión).

- **2026-10-16** — El hub se cayó durante las pruebas. Hipótesis (sin confirmar): (a) los hubs que reinicié desde
  las herramientas de Claude Code mueren con esa sesión de comandos; (b) otro agente trabajando en Synsema en la
  misma PC reinició su servidor (:8120) y pudo matar todos los procesos `synsema`. No fue un choque de puertos. Regla
  desde ahora: el hub lo reinicia Joel desde su terminal.
- **2026-10-16** — No se mergea a `main` por fase: se termina y prueba todo el motor y recién ahí se documenta y se
  mergea. El alcance por ruta es **opcional**: sin `paths` el agente ve todo (uso personal, código, modelo local).

- **2026-10-16** — Fase 1 hecha. Decisiones del camino:
  - La terminal **no** pasa por `deliver`: tiene el historial en memoria y lo modifica entre turnos (notas de
    reanudación, avisos de subagentes, imágenes, `/compact`); recargarlo del disco en cada turno era un cambio
    riesgoso sin beneficio. Usa `runtime.turn`, que mantiene la regla (nadie llama a `run_turn`, todo se traza y se
    guarda en un solo lugar).
  - El system prompt de la terminal se sigue armando una vez por sesión (prompt cache); las opts, en cada turno.
  - Ids de sesión nuevos: `YYYYMMDD-HHMMSS-NNNN`. Con `HHMMSS` solo, dos clientes en el mismo segundo compartían
    sesión. Consecuencia: `session.list` ordenaba con `number()` y 18 dígitos no entran exactos en un float →
    `session.id_key` (entero: timestamp × 10000 + sufijo, ordena viejos y nuevos juntos). La web muestra la hora
    del id (`sessionLabel` en `public/js/sessions.js`), no los últimos 6 caracteres.
  - Un hub viejo en memoria no tiene permiso de leer `run.syn`: copiarlo al workspace es tolerante a eso (se
    saltea) para no romper el encendido de workspaces.
- **2026-10-16** — Arranque. WASM descartado (ver No-objetivos). Canales como contrato + plugins, no adaptadores
  en el núcleo. Regla de oro para que la orquestación no rompa nada: todo entra como mensaje a un agente vía
  `deliver`, y la sesión es `(agente, thread)`.
