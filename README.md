# Refrendo

**A coding agent that doesn't take its own word for it.**

Most AI coding tools finish when the model stops writing. Refrendo finishes when
*your* project's `typecheck`, `test` and `lint` pass. If it can't get there, it
reverts every file it touched and tells you why. You never inherit a half-broken
tree.

```bash
npm install -g refrendo
refrendo serve --demo          # see what it does, no API key needed
```

```yaml
- uses: refrendo/refrendo@v0.1.1
  with:
    goal: ${{ github.event.issue.title }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Opens a pull request **only if your own quality gates pass**. Otherwise it
reverts, comments why, and fails the job.

**Proof it works:** [PR #1](https://github.com/refrendo/refrendo/pull/1) of this
repository was opened by the agent itself, running in GitHub Actions. It planned,
wrote the code, ran the gates, and only then committed. It also found a real
`EPIPE` bug in this codebase, **refused to fix it because it was outside the
approved plan**, and documented it with file and line.

The rest of this README, the CLI and the code comments are in Spanish.
Apache-2.0.

---

**Agente de trabajo verificado.** No conversa sobre tu código: lo cambia, y después demuestra que sigue funcionando.

La diferencia con un asistente de código es una sola: un chatbot termina cuando deja de escribir. Refrendo termina cuando `typecheck`, `test`, `lint` y `build` de **tu** proyecto pasan. Si no lo consigue, revierte todo y te lo dice. Nunca te deja un árbol a medias que alguien tenga que limpiar a mano.

```bash
refrendo run "añade paginación al endpoint de usuarios" \
  --accept "el endpoint acepta ?page y ?limit" \
  --accept "hay test para el caso de página fuera de rango"
```

```
── PLANIFICAR ─────────────────────────────────────
  → list_files .
  → read_file src/routes/users.ts
  1. Añadir parseo de query params        src/routes/users.ts
  2. Cubrir el caso fuera de rango        src/routes/users.test.ts

── EJECUTAR ───────────────────────────────────────
  ± src/routes/users.ts        +24/-6
  ± src/routes/users.test.ts   +31/-0

── VERIFICAR ──────────────────────────────────────
  ✓ typecheck   npm run typecheck · 3.9 s
  ✗ test        npm test · 4.1 s
    │ FAIL  page=0 devuelve 500, se esperaba 400

── REPARAR ────────────────────────────────────────
  ± src/routes/users.ts        +3/-1
  ✓ test        npm test · 4.0 s

 VERIFICADO
$0.4127 · 14 peticiones · 186.4k in, 142.1k de caché / 11.3k out · 78.4 s
```

Ese ciclo `reparar → volver a verificar` es el producto. Todo lo demás es infraestructura para que sea seguro ejecutarlo sin mirar.

---

## Las cinco decisiones de diseño

**1. Contrato, no conversación.** La entrada es un objetivo con criterios de aceptación y restricciones ([`TaskContract`](packages/core/src/types.ts)). La salida es un [`RunResult`](packages/core/src/types.ts) tipado con estado, diff, informe de verificación y coste. Serializable de punta a punta: la CLI, un runner de CI y la futura UI web consumen exactamente lo mismo.

**2. Las puertas las pone el proyecto, no el agente.** [`detectGates`](packages/core/src/verify.ts) lee los scripts de tu `package.json` — con el gestor que uses de verdad, que deduce del lockfile o del campo `packageManager`: npm, pnpm, yarn o bun. Fuera de JavaScript reconoce Go, Rust, Python, Maven y Gradle por su fichero de manifiesto. Si tu `test` pasa, para tu equipo está bien.

Y si usas algo que no sabemos reconocer — Bazel, `make`, `dotnet`, un script propio — lo declaras en `refrendo.config.json` y se ejecuta tal cual. La regla es siempre la misma: **si sale con código 0, la puerta pasa.** Cuando no hay ninguna puerta detectable, Refrendo imprime ese fichero ya escrito para que lo pegues, en vez de dejarte con un `SIN VERIFICAR` y ninguna salida.

**3. Transaccional por defecto.** Cada primera escritura sobre un fichero captura su estado previo en el [`ChangeJournal`](packages/core/src/journal.ts). Si el árbol no llega a verde tras agotar los intentos de reparación, se revierte entero. Un run fallido cuesta dinero, no tiempo de limpieza.

**4. La política es de denegación por defecto.** `rm -rf`, `git push`, `npm publish`, `sudo`, `curl | sh` están bloqueados **siempre**, incluso con `--yes`: son irreversibles o publican fuera de la máquina. Lo que no está en la allowlist pide aprobación humana. Sin TTY se deniega en lugar de preguntar.

El confinamiento de rutas tiene **dos capas, y hacen falta las dos**: [`Workspace.resolve`](packages/core/src/workspace.ts) hace aritmética de rutas (barata, síncrona) y `assertContained` resuelve enlaces simbólicos antes de tocar el disco. Sólo con la primera, un enlace dentro del workspace apuntando fuera basta para escapar — la ruta pasa la comprobación y el sistema de ficheros sigue el enlace igualmente. El recorrido de directorios tampoco atraviesa enlaces.

**5. El coste es un límite, no un informe.** [`Budget`](packages/core/src/budget.ts) suma lo que la API reporta en `usage` y comprueba el tope **antes** de cada petición. Al llegar al 75 % avisa al agente para que cierre ordenadamente en vez de que lo corten a mitad de una edición.

---

## Arquitectura

```
packages/server/src/
├─ share.ts        Enlaces firmados: abren un run, en solo lectura y con caducidad
├─ store.ts        SQLite: runs + traza de solo anexado (sin dependencias nativas)
├─ runner.ts       Ejecuta runs y reparte su traza; confinamiento a repos permitidos
├─ api.ts          Rutas JSON, SSE reanudable y las páginas
├─ html.ts         Plantillas con escapado por defecto
├─ demo.ts         Run de ejemplo para enseñar el producto sin clave
└─ render/         La página del run — el recibo

packages/core/src/
├─ agent.ts        Orquestador: planificar → ejecutar → verificar → reparar → consolidar/revertir
├─ loop.ts         Bucle agéntico (manual, no el tool runner del SDK — ver más abajo)
├─ verify.ts       Detección y ejecución de las puertas de calidad
├─ journal.ts      Diario transaccional con rollback
├─ policy.ts       Denylist dura, allowlist y aprobación humana
├─ budget.ts       Contabilidad de tokens y coste real
├─ workspace.ts    Confinamiento de rutas
├─ events.ts       Stream de eventos tipado (la única superficie de observabilidad)
├─ prompts.ts      Prefijos de sistema cacheados
├─ provider/       Envoltorio del SDK: streaming, caché, herramientas estrictas
└─ tools/          fs · shell · terminales (submit_plan, finish)

packages/cli/src/  Ejecutable + renderizador de eventos
```

El bucle está escrito a mano en lugar de usar `client.beta.messages.toolRunner` porque cada iteración tiene que pasar por cosas que el runner no expone: comprobar presupuesto antes de gastar, **serializar las herramientas que mutan** (dos ediciones concurrentes sobre el mismo fichero se pisan), aprobación humana y cierre por herramienta terminal con esquema estricto.

### Degradación en lugar de aborto

El proveedor pide dos funciones beta: **rescate por rechazo** (si el modelo declina por política, el servidor reintenta en otro en la misma llamada) y **compactación de contexto** (un ciclo largo de reparaciones acumula toda la salida de los tests en la conversación).

Si la API devuelve un `400` porque la cuenta o el modelo no las tienen, se desactivan y se reintenta **una vez**, con un aviso en el stream. Un `401`, un `429` o un `5xx` no se degradan: no se arreglan quitando betas y reintentar sólo gastaría otra petición. El núcleo del agente no depende de ninguna de las dos, así que perderlas es una pérdida de calidad, no de funcionamiento.

El renderizador solo consume `RefrendoEvent` y nunca llama al motor. Esa frontera es lo que permite montar la UI web y las sesiones compartidas de equipo sobre el mismo stream sin tocar el núcleo.

---

## Uso

```bash
npm install -g refrendo
```

O sin instalar nada:

```bash
npx refrendo run "añade paginación al endpoint de usuarios"
```

Para trabajar sobre este repositorio:

```bash
npm install && npm run build
```

Credenciales — cualquiera de las dos:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

o `ant auth login`, que deja un perfil que el SDK lee solo.

| Comando | Qué hace |
|---|---|
| `refrendo run <objetivo>` | Planifica, aplica y verifica |
| `refrendo plan <objetivo>` | Solo planifica; no toca nada |
| `refrendo verify` | Ejecuta las puertas del proyecto |
| `refrendo init` | Crea `refrendo.config.json` con las puertas detectadas |
| `refrendo ci <objetivo>` | Como `run`, pero comitea en una rama **solo si queda verificado** |
| `refrendo serve` | Servidor: historial, trazas en directo y la página de cada run |

### Ver el producto sin clave de API

```bash
refrendo serve --demo
```

Siembra un run de ejemplo —el agente se equivoca, la puerta lo caza, lo arregla y entonces pasa— y te da el enlace. Es la demo, y no necesita credenciales ni repositorio conectado.

Opciones útiles: `--accept` (criterio, repetible), `--max-cost`, `--effort`, `--yes`, `--keep`, `--json`, `-v`.

El código de salida es la señal para CI: **`0` solo si el estado es `verified`.**

### `refrendo.config.json`

Se versiona con el repositorio a propósito — las puertas y el tope de gasto son decisiones de equipo, no preferencias de cada máquina.

```json
{
  "model": "claude-opus-5",
  "effort": "high",
  "limits": { "maxCostUsd": 2, "maxIterations": 25, "maxRepairAttempts": 3 },
  "gates": [{ "name": "test", "command": "npm test" }],
  "allowedCommands": ["docker compose"]
}
```

Precedencia: valores por defecto → fichero → variables de entorno (`REFRENDO_MODEL`, `REFRENDO_EFFORT`, `REFRENDO_MAX_COST_USD`).

---

## Integración con CI

```yaml
- uses: tu-org/refrendo@v1
  with:
    goal: ${{ github.event.issue.title }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    max-cost: "2.00"
```

Ejecuta el agente sobre el repositorio y **abre el pull request solo si las puertas pasan**. Si no lo consigue, revierte, comenta el motivo en la issue y falla el job. Nunca queda una rama a medias esperando revisión.

**El agente no publica.** Crea la rama y el commit; el `git push` y la apertura del PR son un paso explícito del workflow, con las credenciales del pipeline. `git push` sigue en la denylist dura del agente. Quien lea el fichero del workflow ve exactamente dónde sale el código de la máquina — no está escondido dentro de un binario.

El mensaje de commit lleva la procedencia: objetivo, puertas que lo verificaron, ciclos de reparación y enlace a la traza. El autor es la persona que lo pidió, no "Refrendo": el responsable de un cambio es alguien, aunque lo haya tecleado un agente.

## Gobernanza de equipo

Tres cláusulas en `refrendo.config.json`, versionadas con el repositorio:

```json
{
  "requiredGates": ["test", "typecheck"],
  "protectedPaths": ["infra/**", "**/*.tf"],
  "limits": { "maxCostUsd": 2 }
}
```

- **`requiredGates`** cierra el agujero más grande del diseño: las puertas se detectan del proyecto, y el agente puede editar el proyecto. Sin esto, borrar el script de tests deja un árbol que "pasa" porque ya no hay nada que ejecutar. Con esto, la ausencia de una puerta obligatoria **es** un fallo.
- **`protectedPaths`** son rutas que el agente no puede escribir nunca. De serie ya incluye `.github/workflows/**`, `action.yml` y la propia configuración de Refrendo — todo lo que le permitiría falsear su veredicto. Pedirle en el prompt que no las toque es una petición; esto es un cerrojo.
- El **plano de equipo** (`/team`) muestra tasa de verificación y **coste por run verificado** por repositorio y por persona. No hay ranking de actividad individual: medir eso convierte la herramienta en vigilancia y cambia el comportamiento del equipo antes de aportar nada.

**Enlaces compartibles**: `POST /api/runs/:id/share` emite un enlace firmado que abre **ese** run, en solo lectura y con caducidad. La firma cubre identificador y vencimiento juntos, así que no se puede reutilizar en otro run ni estirar la fecha.

## Estado

**Servidor — límites conocidos.** Sin `REFRENDO_TOKEN` solo atiende peticiones locales; con token, exige `Authorization: Bearer` en todas las rutas y compara en tiempo constante. Los runs por API solo pueden tocar los repositorios declarados en `--root`. Lo que **no** hay todavía: enlaces de compartición firmados (hoy quien tiene el token ve todos los runs), SSO y aprobaciones por HTTP — un run lanzado por API deniega lo que requiera aprobación en vez de esperar a nadie.

**Probado:** 235 tests sobre las partes deterministas. Además de las unidades (confinamiento de rutas incluido el escape por enlaces, rollback, denylist, rutas protegidas, puertas obligatorias, aritmética de coste, firmas de compartición), el **orquestador completo** se ejercita contra un proveedor simulado y puertas reales que se ejecutan como subprocesos: verificado a la primera, reparación tras fallo, reversión al agotar intentos, `--keep`, proyectos sin puertas y modo plan. La capa de CI se prueba contra **repositorios Git reales** en temporal: nombres de rama, mensajes con comillas y acentos, autoría, y que un run no verificado no comitea nada.

Del servidor se prueban el almacén (secuencias de traza, proyección de coste, agregados), la API contra un servidor real (autenticación, rechazo de repositorios no permitidos, escape por ruta relativa) y el renderizado — incluido que la salida de comandos, el objetivo y las rutas de fichero se escapan, porque la página del run muestra texto que nadie controla. `npm run typecheck` y `npm test` en verde, 0 vulnerabilidades.

**Validado en vivo** (22 ago 2026, primer run real contra la API):

| | Peticiones | Coste | Duración |
|---|---|---|---|
| `plan` (no escribe nada) | 7 | $0,2799 | 82 s |
| `run` completo hasta VERIFICADO | 10 | $0,2572 | 172 s |

La caché funciona como se diseñó: **45,8k tokens leídos de caché frente a 20 de entrada** en el run completo. Es lo que hace viable un agente de muchas iteraciones.

El primer run real encontró **tres defectos que ningún test había detectado**, porque los tres viven en la frontera con la API o con el mundo real:

1. **Esquemas de herramienta rechazados.** La API no admite `minimum`/`maximum` en propiedades `integer` en modo estricto, y Zod los emite desde `.min()/.max()`. Se podan al serializar; la validación local con Zod los sigue aplicando, que es donde sirven.
2. **Objetos anidados abiertos.** `additionalProperties: false` hay que ponerlo en *todos* los niveles, no solo en la raíz — `submit_plan` lleva objetos dentro de un array.
3. **Falso positivo en la denylist.** El patrón que bloquea el comando `format` de disco cazaba la palabra dentro de una ruta, y bloqueó `npx vitest run .../format.test.ts`. Los nombres de utilidades peligrosas ahora van anclados a posición de comando. Un falso positivo aquí no protege de nada y deja al agente sin poder ejecutar los tests del proyecto.

**Caveat honesto sobre `--max-cost`:** el tope se comprueba *antes* de cada petición, así que detiene el inicio de nuevas llamadas pero no aborta una en vuelo. El desbordamiento máximo es el coste de una petición — el run de `plan` con tope de $0,20 terminó en $0,2799.

**Fuera de alcance de esta iteración**, en orden de dependencia:

1. **Servidor HTTP + SSE** reemitiendo `RefrendoEvent`. El stream ya es serializable; falta el transporte.
2. **Persistencia de runs.** `EventBus.transcript()` ya guarda la traza completa: darle almacenamiento la convierte en historial auditable y reproducible por equipo.
3. **Colaboración.** Varios espectadores sobre un run, aprobaciones delegadas a quien tenga permiso, comentarios anclados a un paso del plan.
4. **Precios por equipo.** El agregado de `usage` por run es la unidad de facturación; falta atribución por usuario y workspace, y cuotas por asiento.

Ese orden no es arbitrario: cada punto depende del anterior, y los cuatro dependen de que el stream de eventos y la contabilidad de coste ya existan — que es justamente lo que hay construido.
