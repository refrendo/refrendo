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

`FECHA_FUENTE` — `commit` · `documentación` · `comando` · `UNVERIFIED`

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
ESTADO: PROPUESTO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: CLAUDE
ORIGEN_REF: análisis presentado al usuario; no aprobado explícitamente
ORIGEN_VERIFICABLE: NO
MOTIVO: [VERIFICADO] Hacker News, Reddit, Product Hunt y LinkedIn tienen portero
(karma, antigüedad o red) y hoy bloquean. El correo directo no tiene portero.
IMPACTO: producto, alcance
CHECK: n/a
BLOQUEA: enviar correos reales a empresas
NO_BLOQUEA: preparar plantillas, construir la lista de empresas, montar el buzón
NOTA: **no se ha enviado ningún correo.** Es una recomendación de Claude, no una
decisión aprobada.

---

## DEC-012 — Proveedor de correo
ESTADO: DESCONOCIDO
FECHA_DECISION: UNVERIFIED
FECHA_REGISTRO: UNVERIFIED
FECHA_FUENTE: UNVERIFIED
FECHA_REF: n/a
ORIGEN: USUARIO
ORIGEN_REF: conversación en curso; sin decisión tomada
ORIGEN_VERIFICABLE: NO
MOTIVO: no se ha elegido entre Hostinger y Google Workspace.
IMPACTO: proveedores, costes, integraciones, seguridad
CHECK: correo-sin-configurar
BLOQUEA: configuración SMTP real, credenciales de envío, registros MX y DKIM,
envío de cualquier correo real
NO_BLOQUEA: plantillas de mensaje, interfaz de envío independiente del proveedor,
tests con emisor falso, la lista de empresas objetivo, el script verificador
NOTA: [VERIFICADO] a 2026-08-27, `refrendo.dev` no tiene MX, SPF, DKIM ni DMARC.
Opciones sobre la mesa: Hostinger (autoconfigura SPF y DKIM, DNS ya allí,
~2,99 $/mes) y Google Workspace (MX único `smtp.google.com` prioridad 1,
6,80 €/mes, DKIM manual).
DESCONOCIDO_CLAVE: la reputación de envío real de cada uno. No se ha medido.
Método acordado para convertirlo en dato: montar el más barato y puntuar con
mail-tester.com. ≥8/10 se queda; <7 se migra.

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

## Cómo añadir o cambiar una decisión

**Nueva:** número correlativo y todos los campos obligatorios — `ESTADO`,
`FECHA`, `FECHA_FUENTE`, `ORIGEN`, `ORIGEN_REF`, `ORIGEN_VERIFICABLE`, `MOTIVO`,
`IMPACTO`, `CHECK`.

**Cambio de estado:** no borres nada. Añade una entrada a `HISTORIAL` con estado
anterior, estado nuevo, origen, fecha con su fuente, motivo e impacto. Si una
decisión sustituye a otra, enlaza `REEMPLAZA:` y marca la anterior como
`REEMPLAZADO` con `REEMPLAZADO_POR:`.

Un histórico de decisiones revertidas vale más que un fichero limpio.
