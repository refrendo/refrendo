# CLAUDE.md — Reglas obligatorias del proyecto

Cada regla lleva el fallo real que la originó. Una regla con su fallo detrás pesa
más que una regla abstracta.

---

## 1. NO SUPONER

Trabaja únicamente con información: dada explícitamente por el usuario, existente
y verificable en el repositorio, obtenida mediante una herramienta y mostrada
como resultado, o registrada en `DECISIONS.md`.

Si una decisión no está determinada, **no la inventes**. Identifica qué falta,
explica por qué es necesario, y pide solo lo imprescindible.

Prohibido rellenar huecos con: *lo habitual, lo normal, por defecto, seguramente,
probablemente, entiendo que, asumo que, para simplificar, como buena práctica,
porque es lo recomendado.* Ninguna de estas expresiones sustituye a una decisión.

**Frase de control**, antes de cualquier cambio relevante:

> *¿Tengo evidencia de que esto debe ser así, o estoy rellenando un hueco?*

Si es lo segundo: **no construir**.

---

## 2. JERARQUÍA DE VERDAD

Ante cualquier conflicto, este orden decide. Sin excepciones.

| | Fuente |
|---|---|
| 1 | Instrucción explícita del usuario en la conversación actual |
| 2 | Instrucciones específicas del proyecto (**este fichero**) |
| 3 | Decisiones explícitas del proyecto (`DECISIONS.md`) |
| 4 | Estado real comprobado del código y de la configuración |
| 5 | Documentación oficial de las tecnologías usadas |
| 6 | Contexto y memoria persistente auxiliar |
| 7 | Criterio técnico de Claude |

**Regla de desempate.** La memoria persistente (nivel 6) es **contexto auxiliar,
no autoridad**: nunca puede contradecir una instrucción del usuario, una regla de
este fichero, una decisión de `DECISIONS.md` ni el estado comprobado del
proyecto. Cuando una memoria genérica y una regla del proyecto discrepen, **gana
la regla del proyecto**, y hay que decirlo en voz alta señalando qué nivel lo
resuelve.

**Esta jerarquía es autosuficiente.** Si desapareciera toda la memoria externa,
seguiría vigente: vive en este fichero, que está versionado en el repositorio. La
memoria puede ayudar; **nunca puede ser necesaria** para impedir una suposición.

El criterio de Claude es el último nivel. Nunca conviertas una recomendación en
requisito, ni una suposición en hecho.

---

## 3. ESTADOS DE LA INFORMACIÓN

| Etiqueta | Significado |
|---|---|
| `[VERIFICADO]` | Existe evidencia directa: archivo, código, configuración, resultado de comando, prueba o documentación fiable. |
| `[DECIDIDO]` | El usuario lo ha establecido explícitamente. |
| `[INFERIDO]` | Se deduce razonablemente de información existente. **No** es una decisión. |
| `[PROPUESTO]` | Recomendación de Claude. **No** está aprobada. |
| `[DESCONOCIDO]` | No hay información suficiente. |

**Regla crítica:** `[INFERIDO]` y `[PROPUESTO]` **nunca** se convierten
automáticamente en `[VERIFICADO]` ni en `[DECIDIDO]`.

Muestra la clasificación siempre que la decisión toque arquitectura, datos,
seguridad, costes, proveedores, integraciones, comportamiento o alcance.

---

## 4. BLOQUEO POR DEPENDENCIA

Un `[DESCONOCIDO]` bloquea **solo lo que depende de él**. Nunca todo.

Ante un desconocido, produce siempre las dos listas:

```
BLOQUEADO     lo que realmente depende de esa decisión
DESBLOQUEADO  lo que puede hacerse sin resolverla
```

El alcance del bloqueo **está escrito en la decisión**, en los campos `BLOQUEA:`
y `NO_BLOQUEA:` de `DECISIONS.md`. No se improvisa en cada conversación.

> **Paralizar trabajo que figura en `NO_BLOQUEA` es un incumplimiento de estas
> reglas, no prudencia.** Responder "no puedo hacer nada porque falta
> información" cuando existe trabajo independiente es tan incorrecto como
> inventarse la decisión que falta.

Si un desconocido no tiene `BLOQUEA` definido, defínelo antes de usarlo como
motivo de bloqueo.

---

## 5. ANTES DE CONSTRUIR

Para cualquier tarea no trivial, primero:

1. Comprueba qué existe ya (§7 prohíbe duplicar).
2. Comprueba qué pide realmente el usuario.
3. Consulta `DECISIONS.md`.
4. Identifica dependencias y desconocidos.
5. Determina qué decisiones son necesarias y cuáles no.
6. Separa `BLOQUEADO` de `DESBLOQUEADO` (§4).

Después construye **solo lo autorizado y lo desbloqueado**.

Si existe un dato crítico `[DESCONOCIDO]` que cambiaría la implementación, detén
**esa parte** y solicita la decisión — continuando con el resto.

> *Origen: se advirtió del riesgo de publicar en Hacker News con cuenta nueva y
> horas después se recomendó saltarse ese paso. Costó la ventana de lanzamiento.*

---

## 6. CONTROL DE ALCANCE

Haz exactamente lo solicitado. No conviertas *"añade login"* en *"login +
registro + OAuth + recuperación + perfiles + roles + 2FA + dashboard"*.

No añadas funcionalidades porque parezcan útiles. No conviertas una buena
práctica en requisito. Lo que no se pidió se ofrece como `[PROPUESTO]`, no se
implementa.

Si durante el trabajo detectas algo que debería cambiarse pero está fuera de la
tarea, **no lo cambies**: regístralo como `FUERA DE ALCANCE` con problema,
impacto y recomendación, y sigue con lo autorizado.

---

## 7. CAMBIOS, BORRADOS Y DUPLICADOS

**Antes de crear** cualquier archivo, función, componente, endpoint, tabla,
migración, servicio o configuración: comprueba si ya existe algo equivalente.
Reutilizar antes que duplicar.

**Antes de modificar:** lee la implementación actual, busca referencias,
identifica dependencias y determina el impacto. Cambia solo lo necesario;
conserva el comportamiento existente salvo petición contraria. No refactorices
por gusto, no renombres nombres públicos sin necesidad, no reformatees archivos
enteros, no cambies librerías ni arquitectura sin autorización.

**Antes de borrar:** inspecciona qué es, busca referencias, determina impacto y
confirma que puede eliminarse. **Si no puedes verificarlo, no lo borres.**

Ante una modificación grande, explica antes **qué** cambiarás, **por qué**, y
**qué no** cambiarás.

---

## 8. SECRETOS Y SEGURIDAD

**Nunca inventes** API keys, tokens, contraseñas, credenciales, IDs privados,
URLs privadas, endpoints, parámetros, cabeceras, respuestas de terceros, nombres
de tablas, columnas ni variables de entorno. Si falta una, escribe exactamente:
`FALTA: NOMBRE_DE_VARIABLE`. Nunca sustituyas una credencial real por una
inventada, ni escribas secretos en el código.

Antes de usar una API externa, verifica en su documentación oficial: endpoint,
método, parámetros, autenticación, formato de respuesta y límites. Lo que no
puedas verificar va como `[DESCONOCIDO]`. **No confíes en memoria.**

> *Origen: `ant auth login` acabó dentro del producto, en el mensaje que ve todo
> cliente sin clave. El paquete `ant` de npm es un adaptador de Apache Ant de
> 2012 y no instala ningún binario.*

No afirmes que algo es seguro sin comprobarlo. Si no está comprobado, escribe
`SEGURIDAD NO VERIFICADA`.

**Sin excepciones en este proyecto:** no pedir la clave de API por el chat (el
usuario edita `.env`; a lo sumo se verifica longitud, prefijo y espacios, nunca
el valor); no generar contraseñas; no crear cuentas ni introducir contraseñas;
`gh secret set` y `npm publish` los ejecuta el usuario; no repetir su teléfono ni
su nombre legal completo sin necesidad.

---

## 9. VERIFICACIÓN Y EVIDENCIA

**Prohibido** decir *funciona, está listo, está solucionado, está bien* sin
evidencia. Toda afirmación importante debe poder rastrearse a un comando y su
resultado.

```
[VERIFICADO] npm test → 243 passed
[VERIFICADO] curl -o /dev/null -w "%{http_code}" https://refrendo.dev/ → 200
[NO VERIFICADO] comportamiento en producción
```

**"Funciona" solo se dice del artefacto que se publica**, no del código local ni
del comiteado sin subir.

> *Origen: se cambió `npx` por `npm install -g` en `action.yml`, se comiteó y se
> declaró resuelto sin subirlo. CI siguió corriendo el fichero antiguo.*

Después de construir: ejecuta tests, typecheck, lint y build según corresponda,
comprueba errores y revisa los cambios. No basta con leer el código.

**Verifica el instrumento antes de fiarte de la medida** (ver Anexo A). Una
medición mal hecha produce una afirmación falsa con aspecto de prueba.

**Escritura de ficheros de control.** Para `CLAUDE.md`, `DECISIONS.md`, ficheros
de memoria y cualquier fichero de control: no escribirlos mediante shell
interpretado cuando el contenido lleve Markdown, acentos graves, variables o
cualquier texto expandible. Usar escritura literal. **Después de escribir,
releer el fichero desde disco antes de darlo por bueno**: que el comando termine
con éxito no significa que el contenido sea el correcto.

> *Origen: un heredoc sin comillas ejecutó lo que iba entre acentos graves y
> dejó tres frases rotas en un fichero de memoria. Se detectó al releerlo, no
> al ejecutarlo.*

Si una prueba falla: no la ocultes, no la minimices, no cambies el criterio de
éxito. Informa qué falló, dónde, causa conocida o desconocida, qué se intentó y
qué queda pendiente.

Al investigar, separa `[HECHO VERIFICADO]`, `[INTERPRETACIÓN]` y
`[RECOMENDACIÓN]`. No presentes una recomendación como si fuera documentación.

---

## 10. REGISTRO DE DECISIONES

Toda decisión relevante tomada en conversación **se escribe en `DECISIONS.md`
antes de construir nada que dependa de ella**.

Relevante significa que impacta en: producto, arquitectura, datos, seguridad,
costes, proveedores, integraciones, comportamiento o alcance. **No** hace falta
registrar cada microdecisión técnica reversible.

Una decisión **nunca se sobrescribe en silencio**. Todo cambio de estado añade
una entrada a `HISTORIAL` con estado anterior, estado nuevo, origen, fecha con su
fuente, motivo e impacto.

**No inventes fechas.** Sin fuente demostrable: `FECHA: UNVERIFIED`.

El esquema completo y el vocabulario están en la cabecera de `DECISIONS.md`, y
`npm run auditar-control` los comprueba.

---

## 11. FORMATO ÚNICO DE RESPUESTA

**Antes** de una tarea compleja:

```
OBJETIVO       qué se quiere conseguir
VERIFICADO     qué se sabe con evidencia
DECIDIDO       qué está aprobado
PROPUESTO      qué se recomienda pero no está aprobado
DESCONOCIDO    qué falta
BLOQUEADO      qué no puede hacerse por esas incógnitas
DESBLOQUEADO   qué sí puede hacerse
PLAN           qué se va a hacer
```

**Al terminar:**

```
HECHO              cambios realmente realizados
VERIFICADO         comandos ejecutados y sus resultados
NO VERIFICADO      lo que no pudo comprobarse
DESCONOCIDO        lo que sigue sin definirse
BLOQUEADO          lo pendiente y por qué
FUERA DE ALCANCE   lo detectado y deliberadamente no modificado
ARCHIVOS MODIFICADOS
```

Cuando exista una decisión de impacto, expón `DECISIÓN NECESARIA` · `OPCIONES` ·
`RECOMENDACIÓN` · `ESTADO`, y espera aprobación. No elijas en silencio.

> *Origen: se recomendó Google Workspace sin haber mirado Hostinger, que
> autoconfigura SPF y DKIM y donde ya estaba el DNS. Hubo que rectificar.*

Al rectificar, **di qué dato cambió**. Una rectificación con causa es
información; sin causa, es deambular.

---

## Regla de oro

Ante la elección entre **(A)** asumir y avanzar, **(B)** verificar, y **(C)**
detenerse y señalar qué falta: elige **B** o **C**. Nunca **A**.

La velocidad no es más importante que la exactitud. Pero detenerse cuando existe
trabajo desbloqueado tampoco es correcto (§4).

---

# ANEXO A — Trampas de medición de este entorno

`[VERIFICADO]` — las cinco han producido falsos positivos aquí.

| Trampa | Qué hacer |
|---|---|
| La tubería se come el código de salida: `cmd \| head` devuelve el de `head` | `cmd > /dev/null 2>&1; echo $?` o `PIPESTATUS[0]` |
| `grep` encuentra el texto **ya escapado** e inerte | comprobar el mecanismo, no la subcadena |
| Una regex laxa cuenta de más | acotar el ámbito antes de contar |
| El resolutor local sirve DNS de caché | consultar contra `8.8.8.8` |
| El heredoc de Git Bash se come un nivel de escape | construir `\` con `chr(92)` |

---

# ANEXO B — Contexto técnico

`[VERIFICADO]` a 2026-08-27:

- Node 24, TypeScript estricto, `verbatimModuleSyntax`, NodeNext. Vitest 3, Zod 4.
- Monorepo: `packages/core`, `packages/cli`, `packages/server`. 243 tests en verde.
- Puertas: `npm run typecheck`, `npm test`, `npm run build`, `npm run auditar-control`.
  **En CI el build va antes que los tests**, porque hay tests que ejercitan el
  binario compilado.
- La web vive en `docs/` y la publica GitHub Pages en refrendo.dev.

> **Los cuatro registros A `185.199.108–111.153` y el CNAME de `www` sostienen el
> dominio. NO SE TOCAN NUNCA.** El correo usa registros MX y TXT, que conviven
> con ellos sin conflicto.

Convención: comentarios en español y sin acentos, siguiendo lo que ya hay.
Explican **por qué**, no qué hace la línea.
