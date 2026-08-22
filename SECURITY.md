# Politica de seguridad

## Reportar una vulnerabilidad

**No abras una issue publica.** Usa el aviso privado de GitHub:

https://github.com/refrendo/refrendo/security/advisories/new

Respondemos en un plazo de 72 horas.

## Que es una vulnerabilidad en Refrendo

Refrendo ejecuta un agente con acceso al sistema de ficheros y al shell. Su
seguridad se apoya en tres barreras, y **cualquier forma de saltarse una de
ellas es una vulnerabilidad**:

1. **Confinamiento de rutas.** El agente no puede leer ni escribir fuera de la
   raiz del workspace. Se comprueba con aritmetica de rutas y resolviendo
   enlaces simbolicos antes de tocar el disco.
2. **Denylist de comandos.** `rm -rf`, `git push`, `npm publish`, `sudo` y
   `curl | sh` estan bloqueados siempre, incluso con la aprobacion automatica
   activada.
3. **Rutas protegidas.** El agente no puede escribir en el pipeline de CI ni en
   la configuracion que define sus propias puertas de verificacion.

Interesa especialmente cualquier caso en que:

- Una ruta escape del workspace
- Un comando de la denylist se cuele reformulado
- El agente consiga modificar sus propias puertas o el workflow que lo ejecuta
- Un enlace de comparticion de un run abra otro run, o no caduque

## Que no lo es

- Que el agente escriba codigo incorrecto: para eso estan las puertas, y por eso
  un run que no las pasa se revierte.
- Que un comando peligroso se ejecute tras una aprobacion humana explicita.

## Claves de API

Refrendo nunca escribe la clave en disco, ni en la traza, ni en el recibo de un
run. Si encuentras una filtracion, es una vulnerabilidad: reportala.
