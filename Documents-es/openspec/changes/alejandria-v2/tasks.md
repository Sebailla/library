# Tareas: alejandria-v2

> Fase: tasks. Cambio: `alejandria-v2`. Almacén de artefactos: híbrido.
> TDD: estricto (pytest + vitest). ROJO → VERDE → REFACTOR por tarea.

## Revisión de Carga de Trabajo — Pronóstico

| Campo | Valor |
|-------|-------|
| Estimación de LOC | ~4600 total (PR1 ~600, PR2 ~1200, PR3 ~2000, PR4 ~800) |
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

- [x] 1.1 ROJO test `services/extractors-py/tests/test_cli.py` para sobre JSON + códigos de salida 0/2/3/4/5 con fixtures de PDF/EPUB.
- [x] 1.2 VERDE implementar `alejandria_sidecar/cli.py` despachador argparse con sobre `schema_version=1`.
- [x] 1.3 VERDE agregar shims de reexportación en `alejandria_sidecar/extractors/{pdf,epub,docx,chm,djvu,cbz,audio,video,image}.py`.
- [x] 1.4 VERDE agregar `alejandria_sidecar/ocr.py` envolviendo `alejandria/ocr/` con `--backend vision|unlimited|tesseract`.
- [x] 1.5 REFACTOR fijar `requires-python = ">=3.11,<3.14"` en `pyproject.toml` (límite de pyobjc-Vision).
- [x] 1.6 DOCS escribir `services/extractors-py/README.md` con uso de `alejandria extract <path>` + tabla de códigos de salida.

## Fase 2: Backend NAS (PR2)

- [ ] 2.1 ROJO test `services/nas-backend/test/health.e2e-spec.ts` afirma que `GET /health` devuelve `{status:"ok"}`.
- [ ] 2.2 VERDE scaffold de `services/nas-backend/` con `docker-compose.yml` para Postgres 16 + pgroonga + Redis.
- [ ] 2.3 VERDE agregar módulos NestJS `auth`, `books`, `search`, `downloads`, `workers`, `discovery`, `database` con capas MVC.
- [ ] 2.4 VERDE escribir `migrations/0001_init.sql` con `BIGSERIAL`, `library_id`, índices pgroonga, ports de triggers FTS5.
- [ ] 2.5 ROJO test `test/workers.e2e-spec.ts`: archivo aparece → job BullMQ → fila en `books`.
- [ ] 2.6 VERDE implementar watcher chokidar + workers BullMQ que disparen `'alejandria', ['extract', path]`.
- [ ] 2.7 VERDE agregar descubrimiento mDNS (`_alejandria._tcp`) + IP Tailscale + endpoints de emparejamiento PIN.
- [ ] 2.8 VERDE agregar `GET /api/files/:id` con soporte `Range` + tabla de log de descargas por dispositivo.
- [ ] 2.9 REFACTOR programar `pgroonga_index_defrag` nocturno vía pg_cron en `migrations/0002_cron.sql`.
- [ ] 2.10 DOCS exponer OpenAPI en `/api/docs` vía `@nestjs/swagger`.

## Fase 3: App Next.js 16 (PR3)

- [ ] 3.1 ROJO test `apps/web/components/__tests__/BookList.test.tsx` (vitest + RTL) renderiza títulos desde fixture.
- [ ] 3.2 VERDE scaffold de `apps/web/` con Next.js 16 + React 19 + Zustand + TanStack Query (App Router).
- [ ] 3.3 VERDE crear `app/(catalog)/page.tsx` RSC + `app/(nas)/browse/page.tsx` RSC con invalidación `'use cache'`.
- [ ] 3.4 VERDE crear `app/reader/[bookId]/page.tsx` `'use client'` + `next/dynamic({ ssr:false })` para pdfjs-dist y epub.js.
- [ ] 3.5 VERDE crear `lib/reader/cfi-wrapper.ts` wrapper versionado alrededor de `epubcfi(...)` (compatibilidad de versión menor de epub.js).
- [ ] 3.6 VERDE agregar server actions `scanLocalFolder`, `downloadFromNas`, `pairDevice` en `app/_actions/`.
- [ ] 3.7 VERDE implementar `packages/core/db/` con better-sqlite3 + FTS5; `source` rastrea `nas_download|local_scan|sidecar`.
- [ ] 3.8 VERDE implementar `lib/scan/local-pipeline.ts` que dispara el sidecar de PR1.
- [ ] 3.9 ROJO test `lib/__tests__/download-flow.test.ts`: mockear INasClient, afirmar request Range + upsert local.
- [ ] 3.10 VERDE implementar `lib/api/nas-client.ts` con descarga por request Range + callback de seguimiento.
- [ ] 3.11 DOCS documentación de componentes en `packages/ui/` para BookList, BookDetail, Reader, NotesPanel, HighlightsPanel.

## Fase 4: Electron + iCloud + ISBN (PR4)

- [ ] 4.1 ROJO test `lib/__tests__/isbn-resolver.test.ts`: cada una de las 7 capas independiente + orden de prioridad de cadena.
- [ ] 4.2 VERDE implementar pipeline de 7 capas `lib/isbn-resolver.ts`: embebido, regex, OpenLibrary, Google Books, Vision OCR en portada, Unlimited-OCR nube, bibliotecas nacionales fuzzy.
- [ ] 4.3 VERDE implementar `lib/sync/icloud.ts` con watcher chokidar + override de env `ALEJANDRIA_ICLOUD_DIR` para desarrollo no-Mac.
- [ ] 4.4 ROJO test `lib/__tests__/sync-conflict.test.ts`: dos escrituras con mtime distinto afirman last-write-wins por `updated_at`.
- [ ] 4.5 VERDE scaffold de `apps/mac/` shell Electron 33: `main.ts`, `preload.ts`, `renderer/` con `contextIsolation: true`.
- [ ] 4.6 VERDE configurar `apps/mac/electron-builder.yml` con target DMG + `electron-updater` apuntando a releases de GitHub.
- [ ] 4.7 VERDE cablear `apps/mac/main.ts` para disparar sidecar Python + resolver ruta de iCloud Drive bajo `com~apple~cloudDocs/Alejandria/`.
- [ ] 4.8 VERDE cablear canales IPC `downloads` + `sync` en `preload.ts` exponiendo API `window.alejandria`.
- [ ] 4.9 VERIFICAR lanzar `dist/Alejandria.app`; sincronizar notas entre dos Macs en <5s; escanear libro NAS end-to-end.
- [ ] 4.10 DOCS README de usuario final + `BUILD.md` con pasos de codesigning + notarización para electron-builder.

## Orden de implementación

PR1 → PR2 → PR3 → PR4 mergean directo a `main`. PR1 entrega el CLI antes de la infra; PR2 los workers lo disparan; PR3 lee la API de PR2; PR4 envuelve PR3.

## Riesgos

Las capas 4-7 de ISBN son código completamente nuevo; iCloud Drive reemplaza la API HTTP de actividad y necesita nuevos e2e; `electron-updater` aún requiere codesign + notarize.
