import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Los tests resuelven los paquetes del monorepo contra el **codigo fuente**, no
 * contra `dist`.
 *
 * Sin esto habria que compilar antes de cada `npm test`, porque los manifiestos
 * apuntan a `dist` para poder publicarse. El bucle de desarrollo se volveria
 * lento justo donde mas rapido tiene que ser.
 */
const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@refrendo/core": src("core"),
      "@refrendo/server": src("server"),
    },
  },
});
