# Tareas: alejandria-v2

> Fase: tasks. Change: `alejandria-v2`. Artifact store: hybrid.
> TDD: estricto (pytest + vitest). RED → GREEN → REFACTOR por tarea.

## Pronóstico de carga de revisión

| Campo | Valor |
|-------|-------|
| Estimación LOC | ~4600 total (PR1 ~600, PR2 ~1200, PR3 ~2000, PR4 ~800) |
| Riesgo de 400 líneas | Bajo por slice |
| PRs encadenados | Sí |
| Estrategia de entrega | auto-chain |
| Estrategia de cadena | stacked-to-main |

```
Decisión necesaria antes de apply: No
PRs encadenados recomendados: Sí
Estrategia de cadena: stacked-to-main
Riesgo de presupuesto de 400 líneas: Bajo
```

## Fase 1: Sidecar Python (PR1)

- [x] 1.1 RED test `services/extractors-py/tests/test_cli.py` para sobre JSON + códigos de salida 0/2/3/4/5 con fixtures PDF/EPUB.
- [x] 1.2 GREEN implementar `alejandria_sidecar/cli.py` despachador argparse con sobre `schema_version=1`.
- [x] 1.3 GREEN agregar shims de reexportación en `alejandria_sidecar/extractors/{pdf,epub,docx,chm,djvu,cbz,audio,video,image}.py`.
- [x] 1.4 GREEN agregar `alejandria_sidecar/ocr.py` envolviendo `alejandria/ocr/` con `--backend vision|unlimited|tesseract`.
- [x] 1.5 REFACTOR fijar `requires-python = ">=3.11,<3.14"` en `pyproject.toml` (techo pyobjc-Vision).
- [x] 1.6 DOCS escribir `services/extractors-py/README.md` con uso de `alejandria extract <path>` + tabla de códigos de salida.

## Fase 2: Backend NAS (PR2)

- [ ] 2.1 RED test `services/nas-backend/test/health.e2e-spec.ts` asegura `GET /health` retorna `{status:"ok"}`.
- [ ] 2.2 GREEN scaffold `services/nas-backend/` con `docker-compose.yml` para Postgres 16 + pgroonga + Redis.
- [ ] 2.3 GREEN agregar módulos NestJS `auth`, `books`, `search`, `downloads`, `workers`, `discovery`, `database` con capas MVC.
- [ ] 2.4 GREEN escribir `migrations/0001_init.sql` con `BIGSERIAL`, `library_id`, índices pgroonga, puertos de trigger FTS5.
- [ ] 2.5 RED test `test/workers.e2e-spec.ts`: archivo aparece → job BullMQ → fila en `books`.
- [ ] 2.6 GREEN implementar watcher chokidar + workers BullMQ que lanzan `'alejandria', ['extract', path]`.
- [ ] 2.7 GREEN agregar descubrimiento mDNS (`_alejandria._tcp`) + Tailscale IP + endpoints de emparejamiento PIN.
- [ ] 2.8 GREEN agregar `GET /api/files/:id` con soporte `Range` + tabla de log de descargas por dispositivo.
- [ ] 2.9 REFACTOR programar `pgroonga_index_defrag` nocturno vía pg_cron en `migrations/0002_cron.sql`.
- [ ] 2.10 DOCS exponer OpenAPI en `/api/docs` vía `@nestjs/swagger`.

## Fase 3: App Next.js 16 (PR3)

- [ ] 3.1 RED test `apps/web/components/__tests__/BookList.test.tsx` (vitest + RTL) renderiza títulos desde fixture.
- [ ] 3.2 GREEN scaffold `apps/web/` con Next.js 16 + React 19 + Zustand + TanStack Query (App Router).
- [ ] 3.3 GREEN crear `app/(catalog)/page.tsx` RSC + `app/(nas)/browse/page.tsx` RSC con invalidación `'use cache'`.
- [ ] 3.4 GREEN crear `app/reader/[bookId]/page.tsx` `'use client'` + `next/dynamic({ ssr:false })` para pdfjs-dist y epub.js.
- [ ] 3.5 GREEN crear `lib/reader/cfi-wrapper.ts` wrapper versionado alrededor de `epubcfi(...)` (compatibilidad de versión menor de epub.js).
- [ ] 3.6 GREEN agregar server actions `scanLocalFolder`, `downloadFromNas`, `pairDevice` en `app/_actions/`.
- [ ] 3.7 GREEN implementar `packages/core/db/` con better-sqlite3 + FTS5; `source` rastrea `nas_download|local_scan|sidecar`.
- [ ] 3.8 GREEN implementar `lib/scan/local-pipeline.ts` que lanza el sidecar de PR1.
- [ ] 3.9 RED test `lib/__tests__/download-flow.test.ts`: mock INasClient, asegura request Range + upsert local.
- [ ] 3.10 GREEN implementar `lib/api/nas-client.ts` con descarga por request Range + callback de tracking.
- [ ] 3.11 DOCS documentación de componentes en `packages/ui/` para BookList, BookDetail, Reader, NotesPanel, HighlightsPanel.

## Fase 4: Electron + iCloud + ISBN (PR4)

- [ ] 4.1 RED test `lib/__tests__/isbn-resolver.test.ts`: cada una de las 7 capas independiente + orden de prioridad en cadena.
- [ ] 4.2 GREEN implementar `lib/isbn-resolver.ts` pipeline de 7 capas: embebido, regex, OpenLibrary, Google Books, Vision OCR sobre portada, Unlimited-OCR cloud, bibliotecas nacionales fuzzy.
- [ ] 4.3 GREEN implementar `lib/sync/icloud.ts` con watcher chokidar + override de env `ALEJANDRIA_ICLOUD_DIR` para desarrollo no-Mac.
- [ ] 4.4 RED test `lib/__tests__/sync-conflict.test.ts`: dos escrituras con mtime distinto asegura last-write-wins por `updated_at`.
- [ ] 4.5 GREEN scaffold `apps/mac/` shell Electron 33: `main.ts`, `preload.ts`, `renderer/` con `contextIsolation: true`.
- [ ] 4.6 GREEN configurar `apps/mac/electron-builder.yml` con destino DMG + `electron-updater` apuntando a releases de GitHub.
- [ ] 4.7 GREEN cablear `apps/mac/main.ts` para lanzar sidecar Python + resolver ruta de iCloud Drive bajo `com~apple~cloudDocs/Alejandria/`.
- [ ] 4.8 GREEN cablear canales IPC `downloads` + `sync` en `preload.ts` exponiendo la API `window.alejandria`.
- [ ] 4.9 VERIFY lanzar `dist/Alejandria.app`; sincronizar notas entre dos Macs en <5s; escanear libro NAS end-to-end.
- [ ] 4.10 DOCS README de usuario final + `BUILD.md` con pasos de codesigning + notarización para electron-builder.

## Orden de implementación

PR1 → PR2 → PR3 → PR4 mergean a `main` directamente. PR1 envía CLI antes que infra; PR2 workers lo lanzan; PR3 lee la API de PR2; PR4 envuelve PR3.

## Riesgos

Las capas 4-7 de ISBN son código nuevo; iCloud Drive reemplaza la API HTTP de actividad y necesita nuevo e2e; `electron-updater` aún requiere codesign + notarize.