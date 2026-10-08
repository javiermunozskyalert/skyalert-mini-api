# tests/

Tests unitarios del proyecto, organizados en **subcarpetas por flujo/módulo**
para identificar fácilmente a qué pertenece cada test.

```
tests/
├── shared/          ← utilidades compartidas (http, connectivity, cache, auth...)
├── devices/         ← usecases del dominio devices
├── history-events/  ← usecases del dominio history-events
├── seismic/         ← usecases del dominio seismic
├── clients/         ← usecases del dominio clients
└── users/           ← usecases del dominio users
```

## Convención
- Un archivo `*.test.ts` por unidad probada.
- Los imports apuntan al código en `src/` (ej. `import { x } from '../../src/shared/http'`).
- Framework: **Vitest**. Correr con `pnpm test` (una vez) o `pnpm test:watch`.

## Estado actual
- `shared/http.test.ts` — stripVersionPrefix (versionado de rutas).
- `shared/connectivity.test.ts` — computeConnectivityStatus (estado de conectividad).

Las subcarpetas de dominios se irán llenando conforme se agreguen tests a los usecases.
