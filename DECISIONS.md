# DECISIONS.md — Memoria de decisiones de Refrendo

Este fichero registra **qué se ha decidido realmente**. `CLAUDE.md` dice cómo hay
que trabajar; esto dice qué está ya cerrado y qué sigue abierto.

**Regla de uso:** nada que esté aquí como `DECIDIDO` se cambia sin autorización
explícita. Nada que esté como `DESCONOCIDO` se implementa "con un valor
razonable" — se pregunta.

Estados: `DECIDIDO` · `PROPUESTO` · `DESCONOCIDO` · `DESCARTADO`

---

## DEC-001 — Lenguaje y plataforma
**Estado:** DECIDIDO · **Fecha:** 2026-08-20

TypeScript estricto sobre Node 24. Monorepo con `packages/core`, `packages/cli` y
`packages/server`.

**Motivo:** decisión explícita del usuario al arrancar el proyecto.

---

## DEC-002 — Proveedor de modelo
**Estado:** DECIDIDO · **Fecha:** 2026-08-20

Anthropic, modelo `claude-opus-5`, vía `@anthropic-ai/sdk`.

**La clave de API la pone el cliente**, no Refrendo. Consecuencia directa: el
margen es alto porque no pagamos tokens, pero la garantía de "los runs revertidos
no se cobran" es más débil de lo que parece — el cliente ya le pagó a Anthropic
por esos tokens.

---

## DEC-003 — Las puertas las pone el proyecto del cliente
**Estado:** DECIDIDO · **Fecha:** 2026-08-21

Refrendo no inventa criterios de calidad. Lee los del proyecto: scripts de
`package.json` con el gestor real (npm, pnpm, yarn, bun), y fuera de JavaScript
reconoce Go, Rust, Python, Maven y Gradle por su manifiesto.

Si no reconoce nada, imprime un `refrendo.config.json` listo para pegar en vez de
rendirse.

**Es la tesis del producto. No se toca sin repensar el producto entero.**

---

## DEC-004 — Licencia
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

Apache-2.0, todo el código incluido el servidor.

**Consecuencia asumida conscientemente:** el plano de equipo es software libre y
cualquiera puede autoalojarlo. Se aceptó a cambio de que el código auditable sea
parte del argumento de venta.

---

## DEC-005 — Nombre y dominio
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

Refrendo. Dominio `refrendo.dev`, registrado en Hostinger, con el DNS también en
Hostinger (`lunar.dns-parking.com`).

`forge.es` y `forge.com` estaban ocupados; ese fue el motivo del cambio de nombre.

---

## DEC-006 — Dónde vive la web
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

GitHub Pages sirviendo la carpeta `docs/` de la rama `main`, con dominio propio y
HTTPS forzado.

`[VERIFICADO]` DNS actual: cuatro registros A `185.199.108–111.153` y CNAME de
`www` → `refrendo.github.io`.

**NO SE TOCAN.** Cualquier trabajo sobre el DNS añade registros nuevos; no edita
estos.

---

## DEC-007 — Precio
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

89 €/repositorio gobernado/mes + 1,20 € por run verificado.
Por repositorio, no por asiento.

**Corrección registrada:** en su día se dijo un margen del ~79 % suponiendo que
pagábamos los tokens. Es incorrecto — ver DEC-002. El margen real es mucho mayor
porque el cliente trae su propia clave.

---

## DEC-008 — No construir facturación hasta tener usuarios
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

El primer cliente se cobra por transferencia y factura manual. Automatizar solo a
partir del tercero.

**Motivo:** construir cobro sin nadie a quien cobrar es trabajo sobre una
suposición.

---

## DEC-009 — Estrategia de idioma
**Estado:** DECIDIDO · **Fecha:** 2026-08-22

Producto, web y documentación en español. Superficies de descubrimiento en inglés:
`action.yml` (es la ficha del Marketplace) y la cabecera del README.

---

## DEC-010 — Identidad visual
**Estado:** DECIDIDO · **Fecha:** 2026-08-27

La R dibujada como un trazo único y continuo que termina en el golpe ascendente
de un visto bueno. La pierna de la R **es** el check.

Ficheros: `docs/logo.svg` (con `currentColor`, hereda el tema), `docs/favicon.svg`
(fondo sólido, trazo más grueso para 16px) y `docs/og.png` (1200×630).

**DESCARTADOS y por qué:** R con check como letra aparte (se leía "RV"); corchete
`[✓]` (es una casilla de verificación, no distingue a nadie); dos postes (se leía
"H"); bucle punteado de "revierte" (desaparecía bajo 40px).

---

## DEC-011 — Canal de captación
**Estado:** PROPUESTO — **no aprobado todavía** · **Fecha:** 2026-08-26

Correo directo en frío como canal principal.

**Motivo:** `[VERIFICADO]` Hacker News, Reddit, Product Hunt y LinkedIn tienen
portero (karma, antigüedad de cuenta o tamaño de red) y hoy bloquean. El correo
directo no tiene portero.

Material preparado: sistema de prospección con fuentes comprobadas, criterios de
filtrado y secuencia de tres toques en ocho días.

**NO se ha enviado ningún correo todavía.**

---

## DEC-012 — Proveedor de correo
**Estado:** DESCONOCIDO · **Fecha:** 2026-08-27

**No está decidido.** No implementar ni configurar nada hasta que se decida.

Estado real `[VERIFICADO]` a 2026-08-27: `refrendo.dev` **no tiene MX, ni SPF, ni
DKIM, ni DMARC**. No puede enviar ni recibir correo.

Opciones sobre la mesa:

- **Hostinger** — `[VERIFICADO]` incluye SPF, DKIM y DMARC y los autoconfigura.
  El DNS ya está allí, así que no hay que editar nada a mano y no se puede romper
  la web por error. ~2,99 $/mes suelto.
- **Google Workspace** — `[VERIFICADO]` MX único `smtp.google.com` prioridad 1;
  6,80 €/mes; 14 días de prueba. DKIM manual, cuatro pasos junto a los registros A.

**Lo que decide y todavía no se sabe:** la reputación de envío real de cada uno.
`[DESCONOCIDO]` — no se ha medido. Método acordado para convertirlo en dato:
montar el más barato y puntuar con mail-tester.com. ≥8/10 se queda; <7 se migra.

Herramienta lista: `verificar-correo.sh` (en el scratchpad de la sesión).

---

## DEC-013 — Antigüedad del dominio
**Estado:** RIESGO CONOCIDO, sin mitigación completa · **Fecha:** 2026-08-27

`refrendo.dev` se registró el 2026-08-22. Al empezar la captación tendrá días de
vida y **cero reputación de envío**.

`[INFERIDO]` Es la señal antispam más fuerte que existe y **ningún proveedor ni
registro DNS la arregla**. Con SPF, DKIM y DMARC correctos se parte con lo mejor
disponible, pero no hay garantía de bandeja de entrada.

**Mitigación acordada:** enviar de dos en dos, nunca los diez de golpe.

---

## DEC-014 — Primer cliente
**Estado:** DESCONOCIDO

Cero usuarios, cero ingresos. Ninguna hipótesis sobre quién será el primer
cliente está confirmada por nadie externo al proyecto.

**Todo lo que se diga sobre qué quiere el mercado es `[PROPUESTO]` hasta que una
empresa real lo confirme.**

---

## Cómo añadir una decisión

Número correlativo, estado, fecha, la decisión en una frase y el motivo. Si
sustituye a otra, enlazarla y marcar la anterior como `DESCARTADO` con la fecha y
el dato que la tumbó — no borrarla. Un histórico de decisiones revertidas vale
más que un fichero limpio.
