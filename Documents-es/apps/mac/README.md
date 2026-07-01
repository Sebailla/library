# `@alejandria/mac`

Shell de Electron 33 para la app macOS de alejandria-v2 (scaffold
de PR-4C, build de producción en PR-4D).

Este paquete aloja la UI web de Next.js en una ventana nativa,
expone un puente IPC `window.alejandria` al renderer, y supervisa
el proceso del sidecar de Python. Es la contraparte de escritorio
del servidor de desarrollo de Next.js en `apps/web`.

## Para usuarios finales — instalar y ejecutar Alejandría

Si descargaste el DMG de un release (por ej.
`https://github.com/Sebailla/library/releases`), esta sección es
para vos.

### Instalación

1. Abrí el DMG (`Alejandría-X.Y.Z.dmg`) que descargaste.
2. **Arrastrá el ícono `Alejandría` al acceso directo de
   `Aplicaciones`.**
3. Si ya tenías una versión anterior instalada, el DMG te pide
   confirmar; hacé clic en "Reemplazar".
4. Expulsá el DMG.

### Primer arranque

Gatekeeper de macOS va a bloquear el primer lanzamiento porque la
app está firmada con un certificado **Developer ID Application**
(no es de la Mac App Store). Dos formas de pasar la validación:

- **Hacé clic derecho en la app** dentro de `/Aplicaciones/` y
  elegí `Abrir`. Confirmá el diálogo de aviso la primera vez. Los
  lanzamientos siguientes se comportan normalmente.
- O andá a `Configuración del Sistema → Privacidad y seguridad`,
  bajá hasta el fondo, y hacé clic en `Abrir de todas formas`
  junto al mensaje que menciona a `Alejandría`. Después arrancala
  normalmente.

Después del primer arranque la app registra el esquema de deep
link `app://`; ya podés cerrar el aviso y empezar a leer.

### Emparejar con el NAS

La primera vez que abrís la app te guía por el emparejamiento:

1. Elegí `Emparejar con NAS…` desde el menú de nivel superior.
2. Ingresá el código de invitación `nas://...` que te envió el
   administrador del NAS (ver `services/nas-backend/README.md`
   para el flujo del operador).
3. La app guarda las credenciales en el Llavero del sistema (NO en
   texto plano). Para auditar o revocar, abrí `Acceso a Llaveros`
   y buscá `Alejandría`.

Después del emparejamiento, la app puede hacer pull y push de tu
biblioteca tocando el botón `Sincronizar ahora` en la pantalla
inicial.

### Dónde viven tus datos

| Qué | Dónde en disco |
|-----|----------------|
| Caché local de la biblioteca (metadata de libros, portadas) | `~/Library/Application Support/alejandria/library.sqlite` |
| Archivos de libros descargados | `~/Library/Application Support/alejandria/books/` |
| Logs del sidecar (proceso Python) | `~/Library/Logs/alejandria/sidecar.log` |
| Anotaciones + estado de lectura sincronizado vía iCloud | `~/Library/Mobile Documents/iCloud~com~alejandria~app/` |

### Sincronización por iCloud

Si iniciás sesión con el Apple ID del dueño de la Mac (y tenés
iCloud Drive activado), las `posiciones de lectura`, `subrayados`,
`notas` y `estado de la estantería` se espejan en la carpeta
`Alejandría` dentro de iCloud Drive. Otros dispositivos Apple que
usen la misma cuenta de iCloud ven la metadata en ~30 segundos.
**Los archivos de libros nunca entran a iCloud — sólo la
metadata.**

Para alternar la sincronización por iCloud:

```
Configuración → Sincronización → iCloud Drive (toggle on/off)
```

Desactivarla conserva los datos locales existentes pero detiene la
sincronización futura. Reactivarla fusiona cualquier desvío que tus
dispositivos hayan acumulado mientras estaba apagada.

### Actualización

La app usa `electron-updater`. En cada lanzamiento consulta
`https://github.com/Sebailla/library/releases/latest/download/latest-mac.yml`
y descarga el siguiente DMG en segundo plano. Vas a ver un chip
pequeño `Actualización lista para instalar` arriba a la derecha —
tocálo para relanzar con la versión nueva.

Si tu máquina está offline o la publicación no está firmada, podés
actualizar manualmente repitiendo los pasos de Instalación.

### Desinstalación

```
rm -rf "/Applications/Alejandría.app"
rm -rf ~/Library/Application\ Support/alejandria
rm -rf ~/Library/Logs/alejandria
# Los datos de iCloud viven en la carpeta del sistema Drive — usá el
# Finder para eliminar el subdirectorio `Alejandría` si querés un
# borrado total.
```

El próximo lanzamiento va a pedir credenciales de emparejamiento
nuevas.

## Para contribuidores — arquitectura y scripts

```
┌──────────────────────────────┐
│ apps/web  (Next.js, dev 3001)│  ← el renderer
└──────────────┬───────────────┘
               │ loadURL (dev) o http://127.0.0.1:<port> (prod)
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
│  │ standalone-server.ts    │ │  spawn del Next.js standalone
│  └────────┬────────────────┘ │  (solo en prod)
│  ┌────────▼────────────────┐ │
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

En producción el renderer es el **Next.js standalone server**
que se distribuye dentro del `.app` en
`Contents/Resources/standalone/`. El proceso main lo arranca
como child process (ver `src/standalone-server.ts`), espera a
que el listener HTTP esté disponible, y hace `loadURL` contra
`http://127.0.0.1:<port>`. El camino de dev
(`loadURL('http://localhost:3001')`) no cambia.

## Scripts

| Comando            | Qué hace                                                     |
|--------------------|--------------------------------------------------------------|
| `npm test`         | Ejecuta la suite unitaria + de integración de vitest (86 tests en 16 archivos). |
| `npm run typecheck`| `tsc --noEmit` contra el tsconfig completo.                  |
| `npm run build`    | Compila `src/*.ts` a `dist/*.js` (input para electron-forge).|
| `npm run dev`      | Arranca Electron en modo dev (carga `http://localhost:3001`).|
| `npm run start`    | Igual que `dev` (alias).                                     |
| `npm run package`  | `electron-forge package` — produce un build mac sin firmar.  |
| `npm run make`     | `electron-forge make` — produce un artefacto DMG + ZIP.      |
| `npm run dist`     | `electron-builder --mac` — produce un DMG codesigned y notarizado (ver `BUILD.md`). |
| `npm run dist:mac:sign`  | `apps/mac/scripts/sign-and-notarize.sh` — codesign + `notarytool submit --wait` de producción. |
| `npm run dist:mac:unsigned` | `electron-builder --mac … --publish never` — codesign + DMG sin tocar GitHub Releases. |

Para que `npm run dev` / `npm run start` sea útil, arrancá el
servidor de desarrollo de Next.js en otra terminal primero:

```sh
cd ../web
npm run dev
# → Next.js listo en http://localhost:3001
```

## Modelo de seguridad

El renderer es una app Next.js plana que no sabe que está
corriendo dentro de Electron. Para mantenerlo así:

- `contextIsolation: true` — el renderer y el preload corren en
  contextos JS separados; nada se filtra entre ellos.
- `nodeIntegration: false` — el renderer no tiene `require`, ni
  `process`, ni `Buffer`.
- `sandbox: true` — el propio script de preload corre en un
  proceso restringido.
- `preload.ts` es el **único** lugar que toca `contextBridge`.
  Publica una superficie congelada y tipada en
  `window.alejandria`; el renderer puede llamar a los cuatro
  métodos pero no puede reemplazar las implementaciones.
- `webContents.setWindowOpenHandler` abre cada enlace externo en
  el navegador por defecto del usuario (niega todos los
  `window.open` desde dentro de la app).
- `webContents.on('will-navigate', …)` bloquea navegaciones
  dentro de la app que se alejen de la URL del renderer.

## Superficie de canales IPC

| Canal            | Llamada del renderer                    | Handler del main-process             |
|------------------|-----------------------------------------|--------------------------------------|
| `aleja:download` | `window.alejandria.download(id)`        | `downloader.download(bookId)`        |
| `aleja:sync`     | `window.alejandria.sync(dir)`           | `syncer.sync('pull'\|'push')`        |
| `aleja:scan`     | `window.alejandria.scan(path)`          | `sidecar.getProcess()` + parse       |
| `aleja:version`  | `window.alejandria.version()`           | devuelve las versiones               |

## Contrato del sidecar

El sidecar de Python emite un sobre JSON versionado en stdout. El
parser en `src/sidecar-client.ts` refleja la misma forma usada por
`apps/web/lib/scan/local-pipeline.ts`:

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

El parser lanza `SidecarEnvelopeError` (con `code` y
`sidecarMessage`) ante sobres de error para que la capa IPC
propague la falla al renderer sin perder el código de error
original del sidecar.

## Plan de tests

- `npm test` — suite unitaria + de integración de vitest (64 tests
  cubriendo `preload`, `sidecar-manager`, `ipc-handlers`,
  `sidecar-client`, `electron-builder`, `npmrc`, `verify-dist`,
  `downloader`, `syncer`, `sidecar.end-to-end`, `updater`, y
  `sign-and-notarize`).
- `npm run build` — `tsc -p tsconfig.build.json` compila
  `src/*.ts` → `dist/*.js` sin errores.
- `npm run start` — arranca Electron en modo dev y carga
  `http://localhost:3001` (requiere el servidor de desarrollo de
  Next.js).
- `node apps/mac/scripts/verify-dist.cjs` — smoke test del `.app`
  ya construido (corrélo desde la raíz del repo).

Ver `BUILD.md` en la raíz del repositorio para el flujo de release
completo (codesign + notaría + publicación en GitHub Releases +
auto-update).

## Estado

PR-N8 — integraciones IPC reales. El downloader (`src/downloader.ts`)
golpea el NAS por `fetch` nativo contra los cuatro endpoints que usa
`apps/web` (`listBooks`, `startDownload`, `downloadFile`,
`completeDownload`). El syncer (`src/syncer.ts`) vigila el directorio
del contenedor `iCloud~com~alejandria~app/` vía chokidar, con `pull()`
que lee el directorio al arrancar y eventos `change` disparados por
cada escritura. El auto-updater (`src/updater.ts`) lee
`process.env.GH_TOKEN` al momento de la llamada para que CI pueda
rotar el secreto entre invocaciones, y degrada a un no-op cuando
`app.isPackaged === false`. El script de codesign + notaría
(`scripts/sign-and-notarize.sh`) usa `xcrun notarytool submit --wait`
para que el script sólo retorne 0 después de que Apple haya firmado
el binario.
