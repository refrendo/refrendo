# Contribuir a Refrendo

## Antes de empezar

```bash
npm install
npm run typecheck
npm test
```

Si eso pasa, tienes el entorno listo. Hace falta Node 22 o superior.

Para probar la herramienta sin publicar nada:

```bash
npx tsx packages/cli/src/index.ts serve --demo
```

## La regla del proyecto

Refrendo existe para que ningun cambio se de por bueno sin evidencia. Eso
aplica tambien a quien lo desarrolla:

**Un pull request se acepta cuando `npm run typecheck` y `npm test` pasan.**
No hay excepciones, y no se relajan los tipos ni se marcan tests como omitidos
para conseguirlo. Una puerta en verde por trampa destruye la unica senal fiable
que tiene el proyecto.

## Que buscamos en un cambio

- **Tests que fallen antes de tu arreglo.** Un test que pasa igual con y sin el
  cambio no demuestra nada.
- **Comentarios que expliquen el porque, no el que.** El codigo ya dice lo que
  hace. Lo que se pierde con el tiempo es la razon.
- **Alcance ajustado.** Refactors y mejoras que nadie ha pedido, en otro pull
  request.

## Estructura

```
packages/core     motor: bucle agentico, puertas, diario, politica, presupuesto
packages/server   persistencia, API con SSE, pagina del run, plano de equipo
packages/cli      ejecutable y renderizado en terminal
```

Los tests viven junto al codigo que prueban, en `src/__tests__/`.

## Codigo de conducta

Se educado y concreto. Se revisan cambios, no personas.
