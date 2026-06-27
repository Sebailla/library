# Especificación del Registro de Bibliotecas

## Propósito

Manages the collection of libraries the user owns, persists them across app restarts, and provides a sidebar control surface for create / switch / rename / delete operations. Each library is isolated in its own SQLite database file so that opening one library never loads the data of another, and so that deletion is a contained operation that never touches the user's source folder.

## Requisitos

### Requisito: CRUD de bibliotecas vía sidebar

The system MUST provide a persistent left sidebar exposing **Create**, **Switch**, **Rename**, and **Delete** operations for libraries. Each library entry MUST display its name, item count, and last-scan timestamp.

The Create operation MUST trigger a native folder picker; the Switch operation MUST close the active DB connection, open the new one, and refresh the UI; the Delete operation MUST open a confirmation modal stating that only the catalog and thumbnails are removed and that the user's source folder is NOT touched.

#### Escenario: El usuario crea una nueva biblioteca

- DADO the sidebar is visible and no library with the chosen root folder exists
- CUANDO the user clicks the `+` button and selects a root folder via the native folder picker
- ENTONCES a new SQLite DB file is created at `~/Library/Application Support/Alejandria/libraries/<uuid>.db`
- Y a registry row is appended to `libraries.json`
- Y an initial background scan starts on the chosen root
- Y the new library becomes active in the sidebar

#### Escenario: El usuario cambia la biblioteca activa

- DADO two libraries `Biología` (active) and `Papers` exist
- CUANDO the user clicks `Papers` in the sidebar
- ENTONCES the active DB connection for `Biología` is closed
- Y the `Papers` DB connection is opened
- Y the catalog UI refreshes to show `Papers` content
- Y the registry file `libraries.json` records `Papers` as the active library

#### Escenario: El usuario elimina una biblioteca con confirmación

- DADO the user right-clicks `Papers` and selects `Delete`
- CUANDO the user confirms the deletion in the modal
- ENTONCES the DB file at `libraries/<id>.db` is removed
- Y the thumbnail folder at `thumbnails/<id>/` is removed
- Y the registry row for `Papers` is removed from `libraries.json`
- Y the user's source folder on disk is NOT touched

### Requisito: Aislamiento de base de datos por biblioteca

The system MUST store each library's catalog in its own SQLite database file at `~/Library/Application Support/Alejandria/libraries/<uuid>.db`. The system MUST NOT load the data of inactive libraries when a library is active.

#### Escenario: Los datos de bibliotecas inactivas no se cargan

- DADO two libraries exist, `A` (1,000 files) is active and `B` (10,000 files) is inactive
- CUANDO the user browses or searches library `A`
- ENTONCES queries are executed against `libraries/<A-uuid>.db` only
- Y the connections for `B`'s DB file are not opened

#### Escenario: El aislamiento de bibliotecas previene escrituras cruzadas

- DADO only library `A` is open in the active connection
- CUANDO an extraction or enrichment completes during a scan of `A`
- ENTONCES the write lands in `libraries/<A-uuid>.db` only
- Y no rows are inserted into any other library's DB file

### Requisito: Registro de bibliotecas y estado activo persistentes

The system MUST persist the list of libraries and the currently active library to `libraries.json` under the application data directory. On application startup, the system MUST reload the registry and restore the last active library.

#### Escenario: La biblioteca activa se restaura después del reinicio

- DADO `Papers` was the last active library before quit
- CUANDO the user relaunches the application
- ENTONCES the registry file is read
- Y `Papers` is automatically opened as the active library
- Y the sidebar reflects `Papers` as the selected entry

#### Escenario: La biblioteca sobrevive al crash de la app

- DADO the user has created three libraries and added files to each
- CUANDO the app is force-killed without graceful shutdown
- ENTONCES on next launch the registry file still lists all three libraries
- Y each library's DB file remains intact on disk

### Requisito: Eliminar una biblioteca nunca modifica las carpetas fuente

The system MUST remove only the catalog data (DB file, thumbnails, registry row) when a library is deleted. The system MUST NOT delete, move, rename, or modify any file inside the user-chosen source folder.

#### Escenario: La eliminación deja intacta la carpeta fuente

- DADO library `Biología` was created from `/Users/me/Books/Biologia/`
- CUANDO the user deletes library `Biología`
- ENTONCES `/Users/me/Books/Biologia/` still exists with all original files
- Y no file inside that path has been modified

### Requisito: Ubicación de datos portable y gestionada por el SO

The system MUST resolve all data paths via `platformdirs` (or equivalent) so that the catalog, thumbnails, and registry live under `~/Library/Application Support/Alejandria/` on macOS. The system MUST NOT use hard-coded user paths such as `/Users/<name>/...` in source.

#### Escenario: Los datos de la app siguen la convención del SO

- DADO the user is `me` on macOS
- CUANDO the app starts and creates data
- ENTONCES `libraries/`, `thumbnails/`, and `libraries.json` are created under `~/Library/Application Support/Alejandria/`
- Y no path in the source code contains a literal `/Users/...` user segment

## Referencias cruzadas

- Depends on: `packaging` (requires the portable path helper to exist)
- Consumed by: every other capability (active library context is required for scan, search, annotations)