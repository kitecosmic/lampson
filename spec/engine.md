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
- [ ] Lampson como servidor MCP: `ask(agent, thread, message)`, `agents()`, `threads(agent)`

### Fase 4 — Canales como plugins
- [ ] Tipo de plugin `channel` en `plugin.json` (ruta webhook entrante + comando `send`)
- [ ] Ejemplo oficial: Chatwoot

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

**Fase actual:** 3 — `lampson mcp serve`. Fases 1 y 2 hechas y probadas. **Rama:** `feat/engine` (desde `main` @ 61fae00).
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
