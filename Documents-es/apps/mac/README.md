# `@alejandria/mac`

Shell de Electron 33 para la app macOS de alejandria-v2 (PR-4C, issue #75).

Este paquete aloja la UI web de Next.js en una ventana nativa, expone un puente IPC `window.alejandria` al renderer, y supervisa el proceso del sidecar de Python. Es la contraparte de escritorio del servidor de desarrollo de Next.js en `apps/web`.

## Arquitectura

```
┌──────────────────────────────┐
│ apps/web  (Next.js, dev 3001)│  ← el renderer
└──────────────┬───────────────┘
               │ loadURL (dev) o app:// (prod)
┌──────────────▼───────────────┐
│ apps/mac  (Electron 33)      │  ← este paquete
│  ┌─────────────────────────┐ │
│  │ preload.ts → window.    │ │  contextIsolation: true
│  │   alejandria.{download, │ │  nodeIntegration: false
│  │   sync, scan, version}  │ │  sandbox: true
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ ipc-handlers.ts         │ │  ipcMain.handle('aleja:*')
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ sidecar-manager.ts      │ │  spawn diferido, SIGTERM/SIGKILL
│  └────────┬────────────────┘ │
└───────────┼──────────────────┘
            │ spawn
            ▼
   ┌──────────────────────┐
   │ python -m            │
   │   alejandria_sidecar │  (compartido con apps/web +
   └──────────────────────┘   services/nas-backend)
```

## Scripts

| Comando            | Qué hace                                                     |
|--------------------|--------------------------------------------------------------|
| `npm test`         | Ejecuta la suite de vitest (26 tests en 4 archivos).         |
| `npm run typecheck`| `tsc --noEmit` contra el tsconfig completo.                  |
| `npm run build`    | Compila `src/*.ts` a `dist/*.js` (input para electron-forge).|
| `npm run dev`      | Arranca Electron en modo dev (carga `http://localhost:3001`).|
| `npm run start`    | Igual que `dev` (alias).                                     |
| `npm run package`  | `electron-forge package` — produce un build mac sin firmar.  |
| `npm run make`     | `electron-forge make` — produce un artefacto DMG + ZIP.      |

Para que `npm run dev` / `npm run start` sea útil, arrancá el servidor de desarrollo de Next.js en otra terminal primero:

```sh
cd ../web
npm run dev
# → Next.js listo en http://localhost:3001
```

## Modelo de seguridad

El renderer es una app Next.js plana que no sabe que está corriendo dentro de Electron. Para mantenerlo así:

- `contextIsolation: true` — el renderer y el preload corren en contextos JS separados; nada se filtra entre ellos.
- `nodeIntegration: false` — el renderer no tiene `require`, ni `process`, ni `Buffer`.
- `sandbox: true` — el propio script de preload corre en un proceso restringido.
- `preload.ts` es el **único** lugar que toca `contextBridge`. Publica una superficie congelada y tipada en `window.alejandria`; el renderer puede llamar a los cuatro métodos pero no puede reemplazar las implementaciones.
- `webContents.setWindowOpenHandler` abre cada enlace externo en el navegador por defecto del usuario (niega todos los `window.open` desde dentro de la app).
- `webContents.on('will-navigate', …)` bloquea navegaciones dentro de la app que se alejen de la URL del renderer.

## Superficie de canales IPC

| Canal            | Llamada del renderer                    | Handler del main-process             |
|------------------|-----------------------------------------|--------------------------------------|
| `aleja:download` | `window.alejandria.download(id)`        | `downloader.download(bookId)`        |
| `aleja:sync`     | `window.alejandria.sync(dir)`           | `syncer.sync('pull'\|'push')`        |
| `aleja:scan`     | `window.alejandria.scan(path)`          | `sidecar.getProcess()` + parse       |
| `aleja:version`  | `window.alejandria.version()`           | devuelve las versiones               |

## Contrato del sidecar

El sidecar de Python emite un sobre JSON versionado en stdout. El parser en `src/sidecar-client.ts` refleja la misma forma usada por `apps/web/lib/scan/local-pipeline.ts`:

```jsonc
// Éxito
{
  "schema_version": 1,
  "result": {
    "book_id": "…",
    "title": "…",
    "author": "…",
    "year": 1963,
    "format": "epub",
    "content_hash": "sha256:…",
    "excerpt": "…"
  }
}

// Error
{
  "schema_version": 1,
  "error": { "code": "FILE_UNREADABLE", "message": "…" }
}
```

El parser lanza `SidecarEnvelopeError` (con `code` y `sidecarMessage`) ante sobres de error para que la capa IPC propague la falla al renderer sin perder el código de error original del sidecar.

## Plan de tests

- `npm test` — 26 tests unitarios cubriendo `preload`, `sidecar-manager`, `ipc-handlers` y `sidecar-client`.
- `npm run build` — `tsc -p tsconfig.build.json` compila `src/*.ts` → `dist/*.js` sin errores.
- `npm run start` — arranca Electron en modo dev y carga `http://localhost:3001` (requiere el servidor de desarrollo de Next.js).

## Estado

Scaffold de PR-4C. El downloader y el syncer son stubs que devuelven `{ ok: true, transport: 'stub' }`; PR-4 los cableará a las implementaciones reales.
