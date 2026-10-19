# Herramientas de una app en Lampson (SDK)

> **Estado (2026-10-18):** las fases 1 a 5 están hechas en la rama `feat/sdk-tools`, siguiendo la respuesta del
> agente de frameworks (`proyectos/datos/reportes/06_respuesta_sdk_tools.md`). Lo que sigue es la propuesta
> original, para tener el porqué.

## Lo hecho

| fase | qué | dónde |
|---|---|---|
| 1 | herramientas `.syn`: `.lampson/tools/<nombre>.syn` (o `tools` del SDK, dentro del proyecto) | `lib/apptools.syn` |
| 2 | `ctx` de confianza: `env("LAMPSON_CTX")` en `.syn` (solo si lo declara), segundo argumento en JS/Python | `runtime.open` → `opts.tool_ctx` → `loop.execute` |
| 3 | `lampson.tool()` / `lampson.tools()` en JS (forma AI SDK, zod o JSON Schema) y `@lampson.tool` en Python (type hints, Pydantic), modo local | `lib/sdktools.syn`, `run.syn` (`tools`, `tool_result`, `tool_request`), `sdk/` |
| 4 | documentación: lampson.org `sdk.md` y `headless.md` (es/en/pt, rama `docs/sdk-tools` del sitio), los dos README | |

Pruebas:
- `run_test.syn`: 9 checks sin modelo (carga, errores, esquema, ctx, suplantación, host no declarado);
- `sdk_test.mjs`: 5; `sdk_test.py`: 2;
- a mano, con un modelo real, las dos formas en el mismo turno.

**Lo que cambió respecto de la propuesta, por el lenguaje (Synsema 0.6.44, probado):**
- Un módulo importado con `use` **no puede tener `require` arriba**, y `use` solo acepta rutas relativas al
  archivo que importa, dentro de su carpeta. Entonces Lampson no importa la herramienta: la corre como programa
  propio, con `synsema run -` y cwd = la carpeta, pasando el archivo tal cual por stdin y agregando **debajo**
  (así los números de línea de un error son los del archivo) una línea que lee los argumentos y otra que llama.
  No se escribe nada en la carpeta del dev.
- Se llama con `call`, no con `call_tool`: `call_tool` corre la función solo con los `require` declarados
  **dentro** de ella, y acá el techo son los del archivo.
- `synsema code outline` mira un archivo por llamada (unos 40 ms): el resultado queda en un caché en disco
  (`.lampson/apptools.json`) que se invalida por nombre, tamaño y fecha de los archivos.
- Sin tipos en la firma, el esquema da el tipo solo cuando el parámetro tiene un default (`false` → boolean,
  `"x"` → string…). Los parámetros obligatorios van sin tipo.

**Arreglado en el camino:** `run --stdio` descartaba el `from` que mandaba la app (la API HTTP no).

**Fase 5, hecha** según la segunda respuesta del agente de frameworks (`06_respuesta_sdk_tools.md`, «Fase 5»):
- **Primero, tres arreglos de seguridad en las callbacks de hoy** (rama `fix/callbacks`, desde `main`):
  - una key sin lista solo llega a hosts públicos (antes, SSRF);
  - la lista compara esquema, host y puerto exactos, y la ruta como carpeta (antes, `starts_with`);
  - cada key nueva tiene su secreto de firma (antes, uno global para todas).
- **Las herramientas viajan en cada mensaje:** `tools` + `tools_url` en `POST /v1/messages`, sin estado en
  Lampson. `tools_url` tiene que estar en la lista de la key (obligatoria acá) y ser https, salvo loopback
  (`lib/api.syn`).
- **La llamada:** `lib/remotetools.syn` hace POST con `{call_id, name, args, ctx}`:
  - firmado con `http_sign` (RFC 9421, el secreto de la key, `keyid` = la key);
  - dentro de `sandbox under {"net": <host de tools_url>}`;
  - la app contesta en ese mismo POST `{output}` o `{error}`;
  - sin reintentos.
- **SDK de JS:** `toolsUrl` / `toolsSecret`, `toolsHandler()` (Web estándar y Node) y `Lampson.verifyToolRequest`.
- **SDK de Python:** `tools_url` / `tools_secret`, `tools_asgi()` y `handle_tool_request()`.
- **Los verificadores** de los dos SDK están probados contra un vector firmado por Synsema: aceptan la firma
  real y rechazan otra URL, otro cuerpo, otro secreto y una firma vieja.
- **Arreglado en el camino:** el buzón abría el turno sin `from`, así que en modo servidor el `ctx.from` de las
  herramientas `.syn` llegaba vacío.

**Revisión del agente de frameworks** (`07_revision_sdk_tools.md`, 2026-10-19). Arreglado:
- **B1, el agente reescribía sus herramientas:** escribir o editar dentro de `.lampson/` (o de la carpeta de
  herramientas) pide aprobación incluso en yolo y se niega en strict; un `bash` que nombra `.lampson` es peligroso
  (`lib/permission.syn`). Un comando de shell ofuscado todavía puede escribir ahí en los modos que no son strict:
  el cierre completo sería un hash aprobado por archivo.
- **B3, IPv6 no canónico:** `host_class` expande la IPv6 y solo da público a `2000::/3` (menos 6to4 y Teredo); las
  mapeadas, compatibles y NAT64 se clasifican por su IPv4. Sin lista, una callback no acepta ninguna IP escrita.
- **El techo de las `.syn` (pregunta 6):** `synsema run --no-env-file --cap-set <sus require>`. El `.env` de la
  carpeta no se carga, un `require` que no está arriba se niega, y `env(…)` solo con nombres exactos, sin
  `LAMPSON_*` salvo `LAMPSON_CTX` (si no, la herramienta no carga y el aviso dice por qué).
- `tools_url` con http solo para loopback de verdad, y sin `#fragmento`.
- SDK: `toolsHandler()` / `handle_tool_request()` / `tools_asgi()` contestan 409 a un `call_id` repetido
  (por proceso, 600 s) y 400 a un cuerpo que no es un objeto; Python usa `fullmatch`.

Decididos por Joel y hechos:
- **B2, conversación por key:** por dentro el thread de la API es `key:<id>:<thread>` (`api.space_of`); la app
  ve el suyo en respuestas, eventos, callbacks y jobs. Aplica a `/v1/messages`, `/stream` y `/v1/mcp` (`ask` y
  `history`). Al actualizar, los threads de la API empiezan de cero una vez. Tampoco se puede escribir en `team:…`.
- **Pregunta 5:** una key con secreto propio y sin lista no pide callbacks; las viejas siguen llegando a nombres
  públicos y `lampson key list` las marca.

Segunda revisión (`08_segunda_revision_sdk_tools.md`), hecho:
- **B1, capa 1:** `common.ws` rechaza los alias de Windows (segmento que termina en `.` o espacio, `~` + dígito,
  `:`), para todas las tools de archivos. Así `in_lampson_dir` e `is_secret_env` ven la única forma de la ruta.
- **B2, la sesión:** ids con `token(16)` en vez de 4 dígitos; `session.valid_id` (nada de `../`); la sesión
  guarda `meta.space` y por la API solo se retoma una de la misma key (si no, 404), sin adoptar su thread.
- **B1, capa 2:** cada archivo de la carpeta (herramientas, `_*.syn`, `README.md`) corre o entra al prompt solo
  con el sha256 que aprobó una persona (`lampson tools list|approve [nombre]`, guardado en `.lampson/` del proceso
  del workspace, fuera del alcance de las tools de archivos). Un cambio la frena hasta aprobarla de nuevo; un
  ayudante cambiado frena a todas. `call` relee y compara justo antes de correr. Modo local del SDK:
  `approveTools: true` / `approve_tools=True` aprueba una vez al arrancar. Falta el botón en la web.
- **Tercera revisión** (`09_tercera_revision_sdk_tools.md`, rama `fix/aprobacion-tools`): se aprueba **toda** `.syn`
  de la carpeta y sus subcarpetas, y si una no está al día no corre ninguna herramienta; `approveTools` solo al
  arrancar `run --stdio`; el `ask` de escribir `apptools_approved.json` lo dice; `seen` que falla → 503 sin correr.
- **Cuarta revisión** (`10_cuarta_revision_sdk_tools.md`): un link a una carpeta dentro de la carpeta de
  herramientas frena todas (`use` lo atraviesa y `list_dir` no entra; se detecta con `file_info`), un `.syn` que no
  se puede leer también (con `try`: antes tumbaba el registro de todos los agentes), uno aprobado y borrado solo se
  muestra (`approve("")` lo saca; si vuelve con otro contenido da "changed"), el 503 de `seen` tiene un mensaje
  fijo (el detalle va al log de la app) y un `seen` async en `handle_tool_request` es un error claro.
- SDK: `toolsHandler({ seen })` / `handle_tool_request(seen=)` / `tools_asgi(seen=)` para compartir el `call_id`
  entre instancias.

Sin hacer (pueden esperar, §3 de la revisión): `lampson key secret <id>`, pasar las callbacks a `http_sign`,
derivar los secretos en vez de guardarlos.

**Pendiente:**
1. **Tipos en la firma de un `task`**, del lado del motor: con eso el esquema sale completo del archivo.
2. `ctx` para plugins (`PLUGIN_CTX`): fácil, pero cambia los plugins, así que queda para cuando haga falta.
3. Un ping del SDK a `toolsUrl` antes del primer `ask`, para detectar el bloqueo de un servidor de un solo
   worker. Por ahora está documentado.

---

> **La propuesta original (2026-10-18).** La escribió el agente de Lampson para el agente que piensa frameworks
> y SDK, con una pregunta: qué conviene para Lampson **y** qué hace que Synsema se destaque frente a otros
> frameworks y lenguajes.

## 1. El problema

Un dev quiere meter un agente en su app (JS o Python) con `npm i lampson` o `pip install lampson`. Ese agente
necesita **herramientas de la app**: consultar un pedido, buscar un cliente, crear una reserva.

Hoy la única forma de que un agente tenga una herramienta propia es un **plugin** o un **servidor MCP**. Los dos
están pensados para alguien que usa Lampson como asistente, no para un dev que programa una app:

- **Plugin:** una carpeta con `plugin.json` y un programa. Está apagado por defecto y lo enciende un humano,
  desde la web, con `/plugins on` o con `lampson plugin on`. Su estado vive en el home de Lampson, no en el repo
  de la app.
- **MCP:** un proceso aparte que habla un protocolo. Para un dev es más pesado que escribir una función.

Joel lo dijo así: una empresa que pone cosas de producción a trabajar con IA busca **garantías**, no plugins.
Tiene que poder escribir su código y lograr lo que quiera con las garantías de Synsema, que Lampson ya
aprovecha.

La prueba de un dev nuevo (2026-10-18), que llegó sin conocer Lampson, sirve de referencia: un agente de
soporte, un plugin de pedidos y el SDK. La comparación con **Eve** (Vercel) está en
`proyectos/datos/referencias/LEEME_eve.md`.

## 2. Lo que ya existe (verificado en el código)

**Origen de las herramientas de un agente**:

| origen | quién lo trae | dónde corre | límite real |
|---|---|---|---|
| propias de Lampson (`bash`, `read`, `write`, `fetch`, `delegate`…) | Lampson | dentro del proceso; `bash` como proceso del sistema | `read`/`write` encerrados en el proyecto por capability de Synsema; **`bash` no**, solo una lista de patrones (`lib/permission.syn`) |
| plugin `kind: "syn"` | el usuario | proceso hijo de Synsema | **techo de capacidades** de su manifiesto (`caps`); el código que pide más falla |
| plugin `kind: "exec"` | el usuario | cualquier comando | ninguno |
| MCP | servidores de terceros | proceso aparte | el del server |
| `send` / `board` | equipos | dentro del proceso | coordinación, sin efectos fuera |

**Más hechos:**

- **Herramientas de un agente propio.** Un `.agent.json` tiene **solo** las herramientas que lista; `base`
  cambia el prompt, no las herramientas. Los agentes integrados (`build`…) tienen todas.
- **Permisos:**
  - una herramienta de plugin o de MCP se **pide** en modo `ask`, se **niega** en `strict` y pasa en `yolo`;
  - un agente puede marcar una herramienta con `"approve": "auto"` para que pase en cualquier modo;
  - `lampson run` y el SDK usan `strict` si el agente no dice su modo.

  Hoy, entonces, la herramienta de un dev **se niega por defecto** en el SDK, salvo que su agente la marque
  `auto` o que el pedido diga `mode: "yolo"`.
- **Contexto.** Una herramienta de plugin recibe sus argumentos (`PLUGIN_ARGS`, que escribe el modelo) y la ruta
  del proyecto. **No recibe quién escribe ni de qué conversación viene.** El sobre (`spec/engine.md`) sí trae
  `from`, `thread` y `meta`, pero no llegan a la herramienta.
- **Ya hecho en la rama `fix/sdk-embebido`**, de la misma prueba:
  - el SDK no toca el hub de otro Lampson;
  - avisa de las herramientas que faltan;
  - acepta `agent` (agente por defecto del cliente);
  - con `lampsonTools: false`, el proceso no ofrece ninguna herramienta propia de Lampson. Esto ya cierra el
    camino de una inyección hacia `bash`, `read`, `write` y `fetch` en una app.

## 3. Pregunta 2: ¿cómo consume Lampson una herramienta escrita en JS o Python?

### Opciones

| | A. Lampson ejecuta el archivo | B. Función registrada en el SDK | C. MCP |
|---|---|---|---|
| cómo se ve | `tools/estado.ts` → `node tools/estado.ts` por llamada | `lampson.tool("estado", spec, fn)` / `@lampson.tool` | un server MCP de la app |
| dónde corre | proceso nuevo por llamada | **dentro del proceso de la app** | proceso aparte |
| contexto de la app (pool de DB, auth, caché) | no, arranca de cero | sí | lo que el server tenga |
| funciona sin la app conectada (hub, tareas programadas, equipos) | sí | **no** | sí, si el server corre |
| Lampson maneja `node_modules` / venvs ajenos | **sí (problema)** | no | no |
| tipos (TS, anotaciones de Python) | a medias | sí | por esquema |
| garantías sobre el cuerpo de la función | ninguna | ninguna | ninguna |
| precedentes | `kind: exec` de hoy | OpenAI function calling del cliente, Eve `tools/*.ts`, AI SDK | ecosistema MCP |

### Cómo sería B en cada modo

- **Local:** el canal ya existe (stdio). Hacen falta mensajes nuevos en el protocolo, por ejemplo:
  - Lampson → SDK: `{"kind": "tool_request", "id", "call": {name, args}, "ctx": {…}}`
  - SDK → Lampson: `{"op": "tool_result", "id", "output" | "error"}`

  Lampson declara las herramientas al catálogo del agente cuando el SDK las registra: un `op: "tools"` al
  arrancar, con nombre, descripción y esquema de parámetros.
- **Servidor:** hace falta un canal de vuelta. Tres caminos:
  - el SDK abre un WebSocket o un long-poll a `/v1`;
  - Lampson llama a un webhook de la app, firmado igual que los callbacks (`X-Lampson-Signature`);
  - B queda solo para el modo local al principio.

### Recomendación (para discutir)

- **B para JS y Python.** Es lo que espera un dev de esos ecosistemas, y Lampson no se mete a manejar
  dependencias ajenas.
- **Archivos solo para Synsema**, ver la pregunta 3. Ahí Lampson sí puede ejecutarlos con garantías, en
  cualquier modo y sin la app conectada.
- **Que la diferencia se vea.** En el registro y en la interfaz, una herramienta `.syn` muestra sus permisos
  (`net(api.mitienda.com)`) y una de JS o Python muestra «código de tu app, sin techo». Esa diferencia visible
  invita a pasar lo sensible (plata, datos de clientes) a Synsema.
- **MCP queda como está.**

### Abierto

1. ¿B solo en modo local al principio, o servidor desde el día uno? Si es servidor, ¿WebSocket o webhook?
2. Un equipo o una tarea programada que necesita la herramienta de una app desconectada: ¿error claro,
   esperar o reintentar? (Para eso existe A, o Synsema.)
3. ¿Timeout, reintentos y concurrencia por herramienta? ¿Lo declara el dev en el registro?

## 4. Pregunta 3: el formato de una herramienta `.syn`

La idea de Joel es una carpeta donde cada archivo es una herramienta, con un README:

```
tools/
  README.md              cuándo usar estas herramientas (va al prompt del agente)
  estado_pedido.syn      1 archivo = 1 herramienta; el nombre del archivo es el nombre
  cancelar_pedido.syn
  buscar_cliente.syn
```

Lo que el archivo tiene que dejar leer **sin ejecutarlo**:
- qué hace;
- qué parámetros recibe;
- qué permisos tiene (sus `require`);
- qué devuelve.

Ejemplo, **con sintaxis tentativa**: hay que confirmar contra la doc de Synsema (MCP `search_docs` /
`get_page`) qué es idiomático y qué hay que agregarle al lenguaje.

```synsema
-- Estado de un pedido: dónde está y cuándo llega.
intent: "consultar el estado de un pedido de la tienda"

require net("api.mitienda.com")        -- todo lo que esta herramienta puede tocar
require secret("TIENDA_API_KEY")

task run(id: text, ctx)                 -- ¿tipos en la firma → esquema JSON para el modelo?
    let r be http_get("https://api.mitienda.com/pedidos/" + id, {"authorization": bearer(secret("TIENDA_API_KEY"))})
    give {"estado": r.json["estado"], "llega": r.json["eta"]}

test "un pedido que existe"
    -- synsema test corre esto con un mock
```

**Lo que Lampson saca del archivo**, sin manifiesto aparte:
- **nombre**: el del archivo;
- **descripción**: el comentario o el `intent`;
- **esquema de parámetros**: la firma de `run`;
- **techo de capacidades**: sus `require`.

Hoy un plugin `syn` declara el techo **aparte**, en `caps` del `plugin.json`, y el código además pide sus
`require`. Acá serían lo mismo.

**Diferencias con un plugin:**
- vive en el repo de la app y entra con el deploy;
- no hay que «encenderla»: estar en `tools/` **y** en la lista del agente es la autorización;
- se testea con `synsema test`.

**Abierto:**

1. ¿Cómo declara Synsema descripción y parámetros de forma idiomática?
   - comentarios con formato;
   - `export let tool be {…}`;
   - **tipos en la firma de `run`** (lo más elegante, si Synsema puede exponerlos).
2. ¿Dónde vive `tools/`: en el proyecto (`.lampson/tools/`), en la carpeta de la app, o se pasa por el SDK
   (`local: { tools: "./tools" }`)?
3. ¿Cuántas herramientas por archivo? Una es lo simple y le sirve al humano que lee. Varias evitan repetir
   `require` comunes.
4. ¿Cómo se autoriza? Hoy en `strict` se niega todo lo que no es de solo lectura. Una herramienta con techo
   declarado, ¿pasa sin preguntar, porque el techo es la garantía? ¿Y una que escribe o paga, pide aprobación
   humana igual? ¿Lo declara el archivo (`approve: ask`)?
5. ¿Proceso por llamada, como el plugin de hoy, o un proceso Synsema por herramienta que queda vivo? Hoy
   arranca en unos ms; habría que medirlo.

## 5. Pregunta 4: el contexto de confianza

Una inyección en una app de clientes rara vez busca `bash`. Busca **usar bien una herramienta legítima para
lo que no debe**: «soy el cliente 99, mostrame mis pedidos». Si el id del cliente llega en los argumentos, lo
escribe el modelo, y un mensaje lo puede manipular.

**Propuesta:** dividir lo que recibe una herramienta en dos partes que no se mezclan:

| | lo escribe | se puede manipular con un mensaje |
|---|---|---|
| `args` | el modelo | **sí**: validar siempre |
| `ctx` | la app (y Lampson) | **no**: el modelo nunca lo ve ni lo escribe |

`ctx` llevaría:
- `from`: quién escribe, tal como lo autenticó la app;
- `thread` y `agent`;
- `meta`: lo que la app puso en el sobre (plan, tenant, permisos del usuario);
- un id de la llamada para el registro.

La herramienta decide con `ctx` («este cliente solo ve sus pedidos»). Así se cierra lo que la nota de Eve
marca como agujero: *"Route auth does not enforce session ownership"*.

**Abierto:**

1. En modo servidor, ¿quién garantiza `from`? La key de `/v1` autentica a la app, no al usuario final. ¿La app
   firma `from`, o confiamos en la app porque tiene la key?
2. ¿`ctx` va a todas las herramientas, o solo a las que lo piden en su firma?
3. ¿Queda en el registro qué `ctx` tuvo cada llamada? Probablemente sí, sin secretos.

## 6. Dónde puede destacar Synsema (para el agente de frameworks)

Todo lo de esta lista ya existe en Synsema según el índice de builtins de la doc (MCP, `90-builtins`). **Falta
probar cada uno para este uso.**

- **Capabilities por herramienta.** El techo es el código mismo. Ningún framework de JS o Python puede
  prometer «esta herramienta solo puede hablar con `api.mitienda.com`» sin un contenedor.
- **Labels (`private` / `declassify`).** Lo que se lee de una base de clientes queda marcado, y una
  herramienta que sale a internet se niega a sacarlo. Defiende contra la exfiltración por inyección, que es el
  agujero que Eve reconoce.
- **`captoken_*`.** Tokens de capacidad que solo pueden achicarse. Podrían ser la forma de pasar `ctx` con
  garantías: la app mintea «este usuario, estos pedidos» y la herramienta lo verifica.
- **`receipt` y lineage.** Cada llamada deja un comprobante verificable de qué código corrió con qué entradas
  (sha256). Es auditoría que un equipo de cumplimiento puede revisar.
- **`spend`.** Topes de gasto por herramienta o por identidad (plata real, no tokens).
- **`synsema test` y modo determinista.** Herramientas testeables con mocks, igual que el resto del código.
- **Tamaño.** Lampson (2,2 MB de paquete, 31 MB en reposo) frente a Eve (27 MB y 191 MB en disco, 106 MB en
  reposo, Node 24).

El relato posible: **«empezá en TypeScript o Python; lo que toca plata o datos de clientes pasalo a `.syn` y
obtenés garantías que tu lenguaje no te puede dar»**. Synsema se adopta por necesidad, no por obligación.

## 7. Lo que se propone crear (por fases, a confirmar)

1. **Contexto de confianza (`ctx`)** para las herramientas que existen hoy (plugins y MCP no lo reciben).
   Sirve sola y es la base de lo demás.
2. **Herramientas `.syn` en `tools/`**:
   - nombre, descripción, parámetros y techo salen del archivo;
   - se autorizan por declaración;
   - se testean con `synsema test`;
   - el registro muestra sus permisos.
3. **Herramientas de la app en el SDK (B), modo local**:
   - `lampson.tool(...)` en JS y `@lampson.tool` en Python;
   - protocolo `tool_request` / `tool_result` en `--stdio`;
   - con tipos.
4. **B en modo servidor** (WebSocket o webhook firmado), si la fase 3 lo justifica.
5. **Documentación:** una receta «agente en tu app» de punta a punta en JS y Python, la que la prueba del dev
   no pudo completar.

## 8. Preguntas para el agente de frameworks

1. ¿B (funciones en el SDK) o A (archivos que ejecuta Lampson) para JS y Python? ¿Algún modelo mejor que
   ninguno de los dos, visto lo que hacen otros frameworks?
2. ¿Qué forma de declarar una herramienta en Synsema haría que un dev de TS o Python diga «esto es mejor que
   lo mío»? ¿Hace falta algo nuevo en el lenguaje (tipos en firmas → esquema, un bloque `tool`)?
3. ¿Labels, captokens o receipts: cuál es el diferencial más fuerte para mostrar primero?
4. ¿El relato «empezá en TS, pasá lo sensible a Synsema» es el correcto, o conviene empujar Synsema desde el
   primer ejemplo?
5. ¿Qué tendría que traer el primer ejemplo de la documentación para que alguien que viene de Eve, LangChain o
   el AI SDK se quede?
