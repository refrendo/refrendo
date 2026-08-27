# DECISIONS.md — Memoria de decisiones de Refrendo

`CLAUDE.md` dice **cómo** hay que trabajar. Este fichero dice **qué está decidido
de verdad**, y qué sigue abierto.

Lo comprueba `npm run auditar-control`. Un fallo estructural rompe el build.

## Reglas de uso

- Nada marcado `DECIDIDO` se cambia sin autorización explícita.
- Nada marcado `DESCONOCIDO` se implementa "con un valor razonable" — se pregunta.
- Una decisión **nunca se sobrescribe en silencio**: todo cambio de estado añade
  una entrada a `HISTORIAL`.
- **No se inventan fechas.** Sin fuente demostrable: `UNVERIFIED`.

## Vocabulario

`ESTADO` — `DECIDIDO` · `PROPUESTO` · `DESCONOCIDO` · `DESCARTADO` · `REEMPLAZADO`

`FECHA_DECISION` — cuándo el usuario tomó la decisión. **Casi nunca es
demostrable**: las decisiones se toman en conversación y una conversación no es
accesible desde CI. Sin evidencia: `UNVERIFIED`.

`FECHA_REGISTRO` — cuándo la decisión quedó registrada en el repositorio. Esto sí
es demostrable, y es lo único que prueba un commit.

`FECHA_FUENTE` — `commit` · `documentación` · `comando` · `conversación` ·
`UNVERIFIED`

`conversación` — la fecha o la decisión proceden de una instrucción explícita del
usuario en la conversación. **No es evidencia reproducible**: un clon aislado del
repositorio no puede volver a ver ese mensaje. El repositorio registra la
procedencia; no la convierte en comprobable. Cuando la conversación sea la
evidencia del origen de la decisión, `ORIGEN_VERIFICABLE` debe ser `NO`.

`FECHA_REF` — el sha cuando la fuente es `commit`; `n/a` en otro caso.

> **Un commit no demuestra cuándo se decidió algo, solo cuándo se escribió.**
> Presentar una fecha de registro como fecha de decisión es fortalecer la
> evidencia más allá de lo que sostiene. El auditor lo rechaza.

`ORIGEN` — `USUARIO` · `CLAUDE` · `REPOSITORIO` · `VERIFICACIÓN`

`ORIGEN_VERIFICABLE` — `SI` (el auditor puede comprobarlo) · `NO` (existe, pero
fuera del alcance del auditor: una conversación no es accesible desde CI)

`CHECK` — identificador de una **lista cerrada** implementada en
`scripts/auditar-control.mjs`. Nunca un comando de shell. Sin comprobación
automatizable: `n/a`.

`BLOQUEA` / `NO_BLOQUEA` — alcance real del bloqueo (`CLAUDE.md` §4). Solo cuando
tengan sentido; no se rellenan por rellenar.

---

## DEC-001 — Lenguaje y plataforma
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: 4061308
ORIGEN: USUARIO
ORIGEN_REF: conversación de arranque; materializado en el commit inicial
ORIGEN_VERIFICABLE: NO
MOTIVO: elección explícita del usuario entre las opciones ofrecidas al arrancar.
IMPACTO: arquitectura
CHECK: stack-typescript

---

## DEC-002 — Proveedor de modelo y quién paga los tokens
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: 4061308
ORIGEN: USUARIO
ORIGEN_REF: conversación de arranque
ORIGEN_VERIFICABLE: NO
MOTIVO: elección explícita del usuario (Anthropic, `claude-opus-5`).
IMPACTO: arquitectura, costes, proveedores
CHECK: n/a
NOTA: la clave de API la pone el cliente, no Refrendo.
NOTA_INFERIDA: [INFERIDO] si el cliente paga los tokens, el margen es alto pero
la garantía "los runs revertidos no se cobran" es más débil de lo que aparenta:
el cliente ya le pagó a Anthropic por esos tokens. No es una decisión, es una
consecuencia razonada y no confirmada por nadie externo.

---

## DEC-003 — Las puertas las pone el proyecto del cliente
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: 4061308
ORIGEN: USUARIO
ORIGEN_REF: encargo inicial; implementado en packages/core/src/verify.ts
ORIGEN_VERIFICABLE: NO
MOTIVO: Refrendo no inventa criterios de calidad; usa los que el equipo ya tiene.
IMPACTO: producto, arquitectura, comportamiento
CHECK: verify-existe
NOTA_INFERIDA: [INFERIDO] es la tesis diferenciadora del producto; cambiarla
obligaría a repensarlo entero. Es valoración de Claude, no una instrucción.

---

## DEC-004 — Licencia Apache-2.0
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: dca3c63
ORIGEN: USUARIO
ORIGEN_REF: autorización explícita de publicar en abierto
ORIGEN_VERIFICABLE: NO
MOTIVO: publicar todo el código, servidor incluido, en abierto.
IMPACTO: producto, costes
CHECK: licencia-apache
NOTA: consecuencia asumida conscientemente — el plano de equipo es software libre
y cualquiera puede autoalojarlo.

---

## DEC-005 — Nombre y dominio
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: cad0d2d
ORIGEN: USUARIO
ORIGEN_REF: el usuario eligió "Refrendo" entre las opciones y compró el dominio
ORIGEN_VERIFICABLE: NO
MOTIVO: `forge.es` y `forge.com` estaban ocupados.
IMPACTO: producto
CHECK: n/a
NOTA: dominio `refrendo.dev`, registrado en Hostinger, con el DNS también allí
(`lunar.dns-parking.com`).

---

## DEC-006 — La web se publica desde `docs/` con GitHub Pages
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: 7e1b953
ORIGEN: USUARIO
ORIGEN_REF: conversación; materializado en el commit
ORIGEN_VERIFICABLE: NO
MOTIVO: publicar la página de producto en el dominio propio sin infraestructura.
IMPACTO: arquitectura, integraciones
CHECK: github-pages-dns
BLOQUEA: nada
NO_BLOQUEA: nada
NOTA: cuatro registros A `185.199.108-111.153` y CNAME de `www` →
`refrendo.github.io`. **No se tocan.** Añadir correo usa MX y TXT, que conviven.

---

## DEC-007 — Precio
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: conversación; la cifra figura en docs/index.html
ORIGEN_VERIFICABLE: NO
MOTIVO: aprobado por el usuario al revisar el material comercial.
IMPACTO: producto, costes
CHECK: precio-en-web
NOTA: 89 €/repositorio gobernado/mes + 1,20 € por run verificado. Por
repositorio, no por asiento.
CORRECCIÓN: en su día Claude afirmó un margen del ~79 % suponiendo que Refrendo
pagaba los tokens. Es incorrecto — ver DEC-002. La cifra corregida no está
confirmada por ningún cliente real.

---

## DEC-008 — No construir facturación hasta tener usuarios
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: conversación
ORIGEN_VERIFICABLE: NO
MOTIVO: construir cobro sin nadie a quien cobrar es trabajo sobre una suposición.
IMPACTO: producto, alcance
CHECK: n/a
NOTA: el primer cliente se cobra por transferencia y factura manual.

---

## DEC-009 — Estrategia de idioma
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: d6fcaeb
ORIGEN: USUARIO
ORIGEN_REF: conversación; materializado en el commit
ORIGEN_VERIFICABLE: NO
MOTIVO: el producto se vende en España; el descubrimiento ocurre en inglés.
IMPACTO: producto
CHECK: accion-en-ingles
NOTA: producto, web y documentación en español. `action.yml` y la cabecera del
README en inglés, por ser superficies de catálogo.

---

## DEC-010 — Identidad visual
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-26
FECHA_FUENTE: commit
FECHA_REF: 57455b7
ORIGEN: USUARIO
ORIGEN_REF: el usuario pidió el logo; Claude propuso y el usuario no objetó
ORIGEN_VERIFICABLE: NO
MOTIVO: la R como trazo único que termina en el golpe de un visto bueno. La
pierna de la R **es** el check.
IMPACTO: producto
CHECK: assets-marca
NOTA: descartados — R con check aparte (se leía "RV"), corchete `[✓]` (es una
casilla, no distingue), dos postes (se leía "H"), bucle punteado (ilegible <40px).
CORRECCIÓN: una versión anterior de este fichero fechaba esta decisión el
2026-08-27. El commit es del 2026-08-26.

---

## DEC-011 — Canal de captación
ESTADO: DECIDIDO
FECHA_DECISION: 2026-08-27
FECHA_REGISTRO: 2026-08-27
FECHA_FUENTE: conversación
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: aprobación explícita del usuario en la conversación actual
ORIGEN_VERIFICABLE: NO
MOTIVO: [VERIFICADO] Hacker News, Reddit, Product Hunt y LinkedIn tienen portero
(karma, antigüedad o red) y hoy bloquean. El correo directo no tiene portero.
ALCANCE: correo directo 1:1, manual, individual y de muy bajo volumen, como canal
inicial de captación y validación. Permite contactar profesionalmente a personas
concretas, con mensajes altamente personalizados, usando únicamente direcciones
profesionales públicas y verificadas; permite discovery, validación y preparar
los mensajes con Claude.
NO_AUTORIZA: campañas masivas, bulk email, scraping + envío, secuencias
automáticas, plataformas de cold email, warm-up artificial, SMTP programático,
automatización de outreach, compra de bases de datos, correos inferidos o
inventados y envíos automáticos a prospectos.
GATE_DE_ENVIO: cada PRIMER contacto externo exige aprobación manual explícita del
usuario en el prompt de `email_call_api_write`. No se crean reglas persistentes
de allow y no se usa "Yes, and don't ask again".
IMPACTO: producto, alcance
CHECK: n/a
BLOQUEA: campañas, automatización de outreach y cualquier envío que no pase por
la aprobación manual de `GATE_DE_ENVIO`.
NO_BLOQUEA: preparar plantillas, construir la lista de empresas, montar el buzón
HISTORIAL:
  - 2026-08-27 · PROPUESTO → DECIDIDO · origen: usuario · fuente-fecha:
    conversación · motivo: aprobación explícita tras comprobarse que Hacker News,
    Reddit, Product Hunt y LinkedIn tienen portero · impacto: fija el canal de
    captación y su alcance, y acota por escrito lo que NO autoriza; no habilita
    por sí misma ningún envío.
NOTA: aprobar esta decisión **no autoriza ningún envío concreto.** Sigue vigente
la instrucción de no contactar prospectos hasta autorización específica. A
2026-08-27 no se ha enviado ningún correo a prospectos.
NOTA_ANTERIOR: mientras estuvo PROPUESTO este campo decía: "**no se ha enviado
ningún correo.** Es una recomendación de Claude, no una decisión aprobada".

---

## DEC-012 — Proveedor de correo
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: decisión explícita en conversación, tras presentarle Hostinger frente a Google Workspace con costes y evidencia
ORIGEN_VERIFICABLE: NO
MOTIVO: **Hostinger**. El DNS del dominio ya está allí —nameservers
`solar/lunar.dns-parking.com`, comprobado—, así que autoconfigura SPF y DKIM sin
que nadie edite registros a mano junto a los cuatro A que sostienen la web.
Cuesta una cuarta parte que Google Workspace: 1,59 €/mes al renovar frente a
6,80 €. Si la entregabilidad medida no da, migrar son veinte minutos.
ALCANCE: **un solo buzón humano, correo manual 1:1 de bajo volumen.** NO implica
ninguna decisión sobre automatización de outreach, plataformas de cold email,
SMTP programático, email transaccional, warm-up ni campañas masivas. Todo eso
sigue siendo DESCONOCIDO y requeriría una decisión aparte.
BUZON_REMITENTE: joan@refrendo.dev
ALIAS_PUBLICO: hello@refrendo.dev
AUTENTICACION: [VERIFICADO] SPF PASS · DKIM PASS · DMARC PASS. Hostinger
autoconfiguró los registros; nadie editó DNS a mano y los cuatro registros A que
sostienen la web quedaron intactos, comprobado antes y después.
ENTREGABILIDAD_INICIAL: [VERIFICADO] medición puntual del arranque, no un
certificado de reputación: Mail-Tester **8.9/10** · SPF PASS · DKIM PASS · DMARC
PASS · Gmail entregó en la pestaña **Principal**, no en spam, en unos 3 segundos
· mensaje enviado como text/plain · sin evidencia de lista negra en la prueba
realizada. Es el dato que sustituye a la opinión que Claude no podía sostener: se
acordó ≥8/10 para quedarse con Hostinger y se cumplió. Cubre los envíos
probados; no dice nada de la trayectoria futura, que sigue en
`DESCONOCIDO_CLAVE`.
ALIAS_ENTREGA: [VERIFICADO] `hello@refrendo.dev` es un alias funcional y los
mensajes enviados a esa dirección se entregan en el buzón `joan@refrendo.dev`.
Comprobado sobre el buzón real con el MCP de Hostinger Email: `GET /api/v1/me`
devuelve `joan@refrendo.dev` como única mailbox del order y responde 200, luego
el buzón es accesible por el MCP. En `INBOX` aparece uid 2, asunto
`Prueba test`, de `jamdoblas@gmail.com` a `hello@refrendo.dev`, fecha
`2026-08-27T17:56:52Z`; el envío recíproco está en `INBOX.Sent` uid 2, de
`joan@refrendo.dev` a `jamdoblas@gmail.com`, fecha `2026-08-27T18:09:25Z`
(20:09 hora de España, CEST).
VERIFICACION_MCP: esa comprobación se hizo **exclusivamente con operaciones
GET / read-only** (`/api/v1/me`, `/folders`, `/folders/{folder}/messages`). No
se envió, borró, movió ni archivó ningún mensaje, y no se tocó ningún flag: los
dos mensajes de `INBOX` seguían con `flags: []` y `unseen: true` tras la lectura.
No se expusieron credenciales — el token Bearer lo inyecta el servidor MCP, no
viajó en argumentos ni apareció en las respuestas. La búsqueda del API
(`POST .../messages/search`) es de clase write y no se usó; bastó listar con GET.
DNS_CONGELADO: no se añade `rua=` al DMARC por ahora, no se migra a Google
Workspace y no se toca ningún registro. Decisión explícita del usuario.
HISTORIAL:
  - (sin fecha demostrable) · DESCONOCIDO → DECIDIDO · origen: usuario ·
    fuente-fecha: conversación · motivo: elegido Hostinger sobre Google Workspace ·
    impacto: desbloquea el outreach por correo, que era el bloqueo principal
    tras confirmarse que no existe cuenta de X.
  - 2026-08-27 · DECIDIDO → DECIDIDO, sin cambio de estado ni de alcance ·
    origen: verificación · fuente-fecha: cabecera `Date` de las respuestas de
    `api.mail.hostinger.com` (`Thu, 27 Aug 2026 19:11:00 GMT`) · motivo: añadida
    evidencia [VERIFICADO] del alias y del acceso al buzón por MCP, solo lectura ·
    impacto: ninguno sobre lo decidido; sigue cubriendo únicamente correo humano
    manual 1:1 y recepción, y no decide marketing, automatización ni
    transaccional.
  - 2026-08-27 · DECIDIDO → DECIDIDO, sin cambio de estado ni de alcance ·
    origen: verificación · fuente-fecha: consulta `nslookup -type=MX refrendo.dev
    8.8.8.8` del mismo día · motivo: corregidas dos contradicciones internas. La
    `NOTA` afirmaba como hecho actual que el dominio no tenía MX, SPF, DKIM ni
    DMARC, cuando eso era el estado previo: pasa a `NOTA_ANTERIOR` y la `NOTA`
    recoge el estado actual. Y `DESCONOCIDO_CLAVE` decía "no se ha medido" junto a
    un 8.9/10: ahora `ENTREGABILIDAD_INICIAL` es la medición puntual `[VERIFICADO]`
    y `DESCONOCIDO_CLAVE` es la reputación sostenida, que sigue `[DESCONOCIDO]` ·
    impacto: ninguno sobre lo decidido; solo semántica temporal y separación entre
    lo medido y lo no medido.
MOTIVO_ANTERIOR: no se había elegido entre Hostinger y Google Workspace.
IMPACTO: proveedores, costes, integraciones, seguridad
CHECK: n/a
CHECK_ANTERIOR: `correo-sin-configurar` comprobaba que el dominio NO tuviera MX.
Servía mientras la decisión estaba abierta: si aparecía un MX, el fichero se
había quedado atrás. Al decidirse Hostinger deja de valer —en cuanto se
configure el buzón habrá MX y esa comprobación fallaría marcando como error lo
que ahora es lo correcto. Se retira en lugar de invertirla: añadir un
`correo-configurado` exigiría tocar `scripts/auditar-control.mjs`, que está
congelado salvo fallo real, y esto no lo es.
BLOQUEA: enviar correo a prospectos antes de verificar SPF, DKIM y DMARC con
evidencia; cualquier automatización de outreach, plataforma de cold email o SMTP
programático, que siguen fuera de esta decisión.
NO_BLOQUEA: contratar el plan, crear el buzón y el alias, configurar los
registros, medir la entregabilidad, preparar la Oleada 1 para correo, publicar
el contacto en la web.
NOTA: [VERIFICADO] estado **actual** del correo del dominio, a 2026-08-27 y ya
configurado Hostinger: registros MX en su sitio —`mx1.hostinger.com` prioridad 5
y `mx2.hostinger.com` prioridad 10, consultados contra `8.8.8.8` para no fiarse
de la caché del resolutor local (Anexo A de `CLAUDE.md`)— y SPF, DKIM y DMARC en
PASS según `AUTENTICACION`. La recepción está comprobada de punta a punta: un
correo de Gmail entró en el buzón a través del alias, ver `ALIAS_ENTREGA`.
NOTA_ANTERIOR: esto describía el estado **previo** a configurar Hostinger y ya no
es un hecho vigente; se conserva porque explica de dónde salió la decisión. Decía:
`[VERIFICADO]` a 2026-08-27, antes del alta del buzón, `refrendo.dev` no tenía MX,
SPF, DKIM ni DMARC; las opciones sobre la mesa eran Hostinger (autoconfigura SPF y
DKIM, DNS ya allí, ~2,99 $/mes) y Google Workspace (MX único `smtp.google.com`
prioridad 1, 6,80 €/mes, DKIM manual).
DESCONOCIDO_CLAVE: [DESCONOCIDO] la reputación y la entregabilidad **sostenidas**
del dominio a medio y largo plazo. El dominio es nuevo y todavía no existe
historial de envío suficiente; que la medición inicial saliera en verde no predice
la trayectoria. Lo que hay medido cubre los envíos de prueba, no una serie. No se
convierte en `[VERIFICADO]` con la evidencia de `ENTREGABILIDAD_INICIAL`.
Relacionado: DEC-013, que trata la antigüedad del dominio como riesgo.
METODO_DE_MEDIDA: el método acordado para el arranque —montar el más barato y
puntuar con mail-tester.com, ≥8/10 se queda y <7 se migra— ya se ejecutó y dio
8.9/10. Para la entregabilidad sostenida no hay método acordado: haría falta
decidir qué se mide, cada cuánto y con qué umbral, y eso es una decisión aparte
que nadie ha tomado.

---

## DEC-013 — Antigüedad del dominio como riesgo de entregabilidad
ESTADO: PROPUESTO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: 2026-08-22
FECHA_FUENTE: commit
FECHA_REF: cad0d2d
ORIGEN: CLAUDE
ORIGEN_REF: análisis de Claude presentado al usuario
ORIGEN_VERIFICABLE: NO
MOTIVO: el dominio se registró en torno al 2026-08-22 y tendrá pocos días de vida
al empezar la captación, con cero reputación de envío.
IMPACTO: integraciones, comportamiento
CHECK: n/a
BLOQUEA: nada
NO_BLOQUEA: nada
NOTA_INFERIDA: [INFERIDO] es la señal antispam más fuerte que existe y ningún
proveedor ni registro DNS la arregla. Es criterio de Claude, no un hecho medido:
no se ha probado la entregabilidad de este dominio.
MITIGACIÓN_PROPUESTA: enviar de dos en dos, nunca los diez de golpe.
CORRECCIÓN: una versión anterior usaba el estado `RIESGO CONOCIDO`, que no existe
en el vocabulario. Reclasificado como `PROPUESTO` por ser análisis de Claude.
La fecha exacta de registro del dominio no se pudo obtener por RDAP; se usa la
del commit de renombrado, que es la primera evidencia en el repositorio.

---

## DEC-014 — Primer cliente
ESTADO: DESCONOCIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: VERIFICACIÓN
ORIGEN_REF: no existe ningún usuario ni ingreso registrado
ORIGEN_VERIFICABLE: NO
MOTIVO: cero usuarios, cero ingresos.
IMPACTO: producto, alcance
CHECK: n/a
BLOQUEA: cualquier afirmación sobre qué quiere el mercado
NO_BLOQUEA: construir, verificar y publicar el producto
NOTA: **todo lo que se diga sobre qué quiere el mercado es `[PROPUESTO]` hasta
que una empresa real lo confirme.**

---

## DEC-015 — La siguiente versión pública será 0.1.0
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: aprobación explícita en conversación, tras presentarle 0.1.0 frente a 0.0.2
ORIGEN_VERIFICABLE: NO
MOTIVO: en 0.x no hay contrato de estabilidad, pero el segundo dígito comunica
que la superficie cambió: se detectan ecosistemas nuevos y hay una bandera nueva.
0.0.2 subestimaría 419 líneas de producto.
IMPACTO: producto, integraciones
CHECK: n/a
BLOQUEA: publicar en npm, crear la etiqueta v0.1.0, apuntar la Action a 0.1.0
NO_BLOQUEA: subir las versiones en los manifiestos, verificar el empaquetado,
cualquier trabajo sobre el código
NOTA: [VERIFICADO] a 2026-08-27 npm sirve 0.0.1 publicada el 2026-08-22, mientras
el repositorio lleva 419 líneas de arreglos sin publicar — entre ellos la
instrucción inexistente `ant auth login` que ve todo cliente sin clave.
NOTA_ORDEN: la publicación va en orden topológico core → server → cli, porque
server depende de core y cli de ambos.
NOTA_TAG: la etiqueta v0.0.1 **no se mueve**. Ya está publicada y algo podría
depender de ella. La v0.1.0 será una etiqueta nueva.

---

## DEC-016 — `--report` es funcional; `verify` lo rechaza en vez de fingirlo
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: decisión explícita en conversación, opción A y luego V1, tras presentarle la evidencia
ORIGEN_VERIFICABLE: NO
MOTIVO: aceptar una opción en silencio y luego ignorarla es un bug. Si el usuario
pide un informe y no puede dársele, tiene que enterarse.
IMPACTO: producto, comportamiento
CHECK: n/a
BLOQUEA: publicar 0.1.1
NO_BLOQUEA: implementar la corrección, escribir los tests, verificar en local
NOTA: comportamiento decidido — `run` y `plan` escriben el informe; `ci` queda
exactamente igual; `verify` **falla con diagnóstico explícito y exit distinto de 0**.
NOTA_EVIDENCIA: [VERIFICADO] `run`, `ci` y `plan` comparten rama en
packages/cli/src/index.ts y los tres producen un RunResult completo. `verify`
devuelve un VerificationReport con solo tres campos —passed, gates, ranAt—
mientras que renderMarkdownReport necesita nueve. Fabricar los ocho que faltan
seria inventar semántica, y `verified` significa "los cambios del agente pasaron
las puertas" cuando en `verify` no hubo cambios.
NOTA_ALCANCE: no se diseña ningún formato de informe para VerificationReport.
Eso seria funcionalidad nueva y queda fuera.

---

## DEC-017 — La corrección de `--report` se publica solo como CLI 0.1.1
ESTADO: DECIDIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: decisión explícita en conversación, opción B, tras presentarle A y B con evidencia
ORIGEN_VERIFICABLE: NO
MOTIVO: la corrección de `--report` se publicará como `refrendo` CLI 0.1.1;
`@refrendo/core` y `@refrendo/server` permanecen en 0.1.0 porque no contienen
cambios ni metadatos que requieran republicación.
IMPACTO: producto, integraciones
CHECK: n/a
BLOQUEA: publicar refrendo 0.1.1, apuntar action.yml a 0.1.1, crear la etiqueta v0.1.1
NO_BLOQUEA: subir la version en el manifiesto del CLI, verificar el empaquetado
NOTA_ALCANCE: **esta decisión NO establece una política universal de versionado
independiente para el monorepo.** Es una decisión sobre esta release concreta.
Convertirla en regla general para releases futuras exige una decisión explícita
del usuario. Ver DEC-015, que tampoco era una política.
NOTA_EVIDENCIA: [VERIFICADO] el commit 710b78c toca solo packages/cli; core y
server no cambian ni una línea. Nadie depende de `cli` —la dependencia va en
sentido contrario—, y los rangos `^0.1.0` siguen resolviendo a 0.1.0, que es lo
publicado, así que no hay metadato que actualizar en ninguno de los dos.
NOTA_PRECEDENTE: en 0.1.0 se republicó `@refrendo/server` pese a no tener cambios
de código, pero por una razón distinta: su rango de dependencia pasó de `^0.0.1`
a `^0.1.0` y sin republicar su manifiesto habría seguido apuntando a core 0.0.1.
No fue lockstep. Aquí ese rango no cambia.
NOTA_CORRIGE: DEC-016.

---

## Cómo añadir o cambiar una decisión

**Nueva:** número correlativo y todos los campos obligatorios — `ESTADO`,
`FECHA`, `FECHA_FUENTE`, `ORIGEN`, `ORIGEN_REF`, `ORIGEN_VERIFICABLE`, `MOTIVO`,
`IMPACTO`, `CHECK`.

**Cambio de estado:** no borres nada. Añade una entrada a `HISTORIAL` con estado
anterior, estado nuevo, origen, fecha con su fuente, motivo e impacto. Si una
decisión sustituye a otra, enlaza `REEMPLAZA:` y marca la anterior como
`REEMPLAZADO` con `REEMPLAZADO_POR:`.

Un histórico de decisiones revertidas vale más que un fichero limpio.
