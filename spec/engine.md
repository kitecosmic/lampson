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
- [ ] En la terminal, un agente del proyecto con `model` propio usa igual el modelo configurado (`chat.syn` tiene
      su `cfg` global para `/model`). Web y `lampson run` sí lo respetan.
- [ ] Agentes globales (`<LAMPSON_HOME>/agents/`): sumar `agents` a `LINKS` de `lib/workspaces.syn` y a `bin/lampson.js`.
- [ ] Test automático de `POST /api/chat` (hoy solo hay prueba manual; `web_test.syn` es una copia local vieja).
- [ ] `lampson run --stdio`: un proceso que queda abierto, un sobre JSON por línea de stdin → eventos JSONL
      (base del SDK de la fase 5).

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
- [ ] Rate limit por key (`rate_limit` de Synsema en las rutas `/v1`, o propio por key).
- [ ] Probar el modo `ask` por la API con una aprobación real (el código reusa la cola; no tiene test propio).
- [ ] Las keys solo se ven por la CLI: falta panel en la web (va con la documentación, al final).
- [ ] Callback a una URL arbitraria: quien tiene una key puede hacer que Lampson haga POST a cualquier lado
      (incluida la red local). Aceptable porque la key es de confianza; evaluar una allow-list por key.

### Fase 3 — `lampson mcp serve`
- [x] Lampson como servidor MCP por stdio (`lib/mcp_server.syn`, dentro de `run.syn` con `LAMPSON_MCP_SERVE=1`):
      `lampson mcp serve [--agent ID[,ID]] [--workspace RUTA]`. Tools `ask(message, agent?, thread?)` y `agents()`.
      Sin thread, `ask` crea uno (`mcp:…`) y lo devuelve en el texto y en `structuredContent` para continuar. Con un
      solo agente ofrecido, `ask` no pide `agent`. Sin humano → `strict` salvo que el agente diga otra cosa.
- [x] Test en `run_test.syn` (JSON-RPC por stdin como un cliente real: initialize, tools/list, ask, continuación por
      thread, agente no ofrecido, método desconocido) y a mano por el launcher en `e-commerce` con el modelo real:
      stdout solo JSON-RPC, stderr vacío.

**Pendientes que salieron en la fase 3:**
- [ ] `threads(agent)` / historial de una conversación (se dejó fuera: el cliente ya guarda su thread).
- [ ] Los requests se atienden de a uno (un `ask` largo demora al siguiente); el cliente MCP típico espera igual.
- [ ] Notificaciones de progreso (`notifications/progress`) mientras el agente trabaja.
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
- [ ] Respuestas en streaming (SSE) desde nuestro servidor MCP y progreso mientras el agente trabaja.
- [ ] `tty_test` intermitente (~1 de cada 20-25 corridas): la vez que se pudo ver, quedó colgado después del paso
      Esc, antes de `/exit` (que mide 0,1 s; ese camino no cambió). Parece del manejo de la PTY bajo carga, no del
      motor. Si se vuelve frecuente: timeout propio por paso y volcar la pantalla al fallar.

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
- [ ] Probar `plugins/chatwoot` contra un Chatwoot real (formato verificado con la doc oficial; `message_type`
      llega como texto o número según la versión, cubierto).
- [ ] Imágenes entrantes: hoy van como link en el texto; pasarlas como imagen si el modelo tiene visión.
- [ ] Indicador de "escribiendo…" mientras el agente trabaja (acción opcional `typing` del canal).
- [ ] Panel de canales en la web (encender, ver el log, la URL del webhook) — con la documentación final.
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
- [ ] Probar `plugins/telegram` con un bot real (hace falta un token de @BotFather y la URL pública por https).
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
- [ ] npm: `import { Lampson } from "lampson"` (wrapper sobre `lampson run --stdio` o la API)
- [ ] Python, si hay demanda

### Fase 6 — Orquestación (rama propia, después del motor)
- [ ] Tool `send(to, text)` entre agentes → `deliver` (generaliza `delegate`)
- [ ] Tablero compartido de tareas (estado, dueño, dependencias) — blackboard de Synsema
- [ ] Despertadores por agente: mensaje, cron (`lib/schedule.syn`), evento; sin trabajo → no corre
- [ ] Repaso periódico barato con `judge` ("¿hay algo para mí?") antes de gastar un turno completo
- [ ] Equipos: carpeta de agentes con roles; estilos coordinador (un jefe reparte) y tablero (cada uno toma lo suyo)
- [ ] Presupuesto diario por agente y por equipo

## Estado

**Fase actual:** 5 — SDK (5a OpenAPI hecha). Fases 1, 2 (con el buzón), 3, 3b y 4 hechas y probadas. **Rama:** `feat/engine` (desde `main` @ 61fae00).
**Sin merge a `main` hasta terminar y probar todo el motor** (decisión de Joel, 2026-10-16): por ahora solo nosotros
sabemos que existe. **Documentación pública al final**, con todo probado; mientras tanto el detalle vive acá.

## Ramas

- `main`: lo publicado. Se llega por merge de las otras.
- `fix`: arreglos chicos. Al terminar una tanda: merge a `main` y `fix` se adelanta a `main` (fast-forward).
- `feat/<tema>`: trabajo grande (`feat/engine`, después `feat/orchestration`). Se mergea a `main` al cerrar
  una fase que deja todo funcionando; si `main` avanzó (por `fix`), se trae `main` a la rama antes.

## Bitácora

Decisiones y cambios de rumbo, lo más nuevo arriba.

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
