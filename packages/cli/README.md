# refrendo

**Agente de trabajo verificado.** No conversa sobre tu código: lo cambia, y después demuestra que sigue funcionando.

Un asistente de código termina cuando deja de escribir. Refrendo termina cuando `typecheck`, `test` y `lint` de **tu** proyecto pasan. Si no lo consigue, revierte todo y te lo dice. Nunca te deja un árbol a medias que alguien tenga que limpiar a mano.

```bash
npm install -g refrendo
```

```bash
refrendo run "añade paginación al endpoint de usuarios" \
  --accept "el endpoint acepta ?page y ?limit" \
  --accept "hay test para el caso de página fuera de rango"
```

## Ver qué hace, sin clave de API

```bash
refrendo serve --demo
```

Siembra un run de ejemplo —el agente se equivoca, la puerta lo caza, lo arregla y entonces pasa— y te da el enlace a su recibo.

## Comandos

| Comando | Qué hace |
|---|---|
| `refrendo run <objetivo>` | Planifica, aplica y verifica |
| `refrendo ci <objetivo>` | Igual, pero comitea en una rama **solo si queda verificado** |
| `refrendo plan <objetivo>` | Solo planifica; no toca nada |
| `refrendo verify` | Ejecuta las puertas de calidad del proyecto |
| `refrendo serve` | Servidor: historial, trazas y la página de cada run |
| `refrendo init` | Crea `refrendo.config.json` |

El código de salida es la señal para CI: **`0` solo si el resultado es `verified`**.

## Credenciales

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

O un fichero `.env` en la raíz del proyecto. La clave se obtiene en [console.anthropic.com](https://console.anthropic.com) — que se factura aparte de cualquier suscripción de Claude.

## Seguridad

`rm -rf`, `git push`, `npm publish`, `sudo` y `curl | sh` están bloqueados **siempre**. El agente no puede salir del repositorio ni escribir en tu pipeline de CI, y todo lo que toca se puede revertir entero.

Documentación completa y arquitectura: https://github.com/refrendo/refrendo

Apache-2.0
