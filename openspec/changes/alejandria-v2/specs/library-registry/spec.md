# Delta for library-registry

## MODIFIED Requirements

### Requirement: CRUD de bibliotecas vía sidebar

The system MUST provide a persistent left sidebar exposing **Create**, **Switch**, **Rename**, and **Delete** operations for libraries. Each entry MUST display name, item count, and last-scan timestamp.

The Create operation MUST trigger a native folder picker; Switch MUST close the active DB connection, open the new one, and refresh the UI; Delete MUST open a confirmation modal stating that only the catalog and thumbnails are removed.

(Previously: identical. The registry is now mirrored to the NAS `libraries` table; deletion cascades on the NAS side too.)

#### Scenario: El usuario crea una nueva biblioteca

- GIVEN the sidebar is visible and no library with the chosen root folder exists
- CUANDO the user clicks `+` and selects a root folder
- ENTONCES a new SQLite DB is created at `libraries/<uuid>.db`
- Y a row is appended to `libraries.json`
- Y an initial background scan starts
- Y the new library becomes active

#### Scenario: El usuario cambia la biblioteca activa

- GIVEN `Biología` is active and `Papers` exists
- CUANDO the user clicks `Papers`
- ENTONCES the active DB connection for `Biología` is closed
- Y `Papers` is opened
- Y the catalog UI refreshes
- Y `libraries.json` records `Papers` as active

#### Scenario: El usuario elimina una biblioteca con confirmación

- GIVEN the user selects Delete on `Papers`
- CUANDO the user confirms
- ENTONCES the DB file is removed
- Y the thumbnail folder is removed
- Y the registry row is removed
- Y the user's source folder is NOT touched

### Requirement: Aislamiento de base de datos por biblioteca

The system MUST store each library's catalog in its own SQLite at `~/Library/Application Support/Alejandria/libraries/<uuid>.db`. The system MUST NOT load inactive libraries when one is active.

(Previously: identical isolation rule. Per-library DB files are now a local mirror of the shared NAS `libraries` table.)

#### Scenario: Los datos de bibliotecas inactivas no se cargan

- GIVEN `A` (1,000 files) is active and `B` (10,000) is inactive
- CUANDO the user browses `A`
- ENTONCES queries hit `libraries/<A-uuid>.db` only
- Y `B`'s connection is not opened

#### Scenario: El aislamiento previene escrituras cruzadas

- GIVEN only `A` is open
- CUANDO an extraction completes during a scan of `A`
- ENTONCES writes land in `libraries/<A-uuid>.db` only

### Requirement: Registro de bibliotecas y estado activo persistentes

The system MUST persist the list of libraries and the currently active library to `libraries.json`. On startup, the system MUST reload the registry and restore the last active library.

(Previously: the registry was the source of truth. The JSON file is now a local cache; the NAS `libraries` table is the source of truth.)

#### Scenario: La biblioteca activa se restaura después del reinicio

- GIVEN `Papers` was the last active library
- CUANDO the app relaunches
- ENTONCES the registry file is read
- Y `Papers` is automatically opened

#### Scenario: La biblioteca sobrevive al crash de la app

- GIVEN three libraries and files in each
- CUANDO the app is force-killed
- ENTONCES on next launch the registry still lists all three libraries

### Requirement: Eliminar una biblioteca nunca modifica las carpetas fuente

The system MUST remove only the catalog data (DB file, thumbnails, registry row) when a library is deleted. The system MUST NOT touch any file in the user-chosen source folder.

(Previously: identical. The NAS also cleans up `downloads` rows that referenced the deleted library.)

#### Scenario: La eliminación deja intacta la carpeta fuente

- GIVEN `Biología` was created from `/Users/me/Books/Biologia/`
- CUANDO the user deletes it
- ENTONCES `/Users/me/Books/Biologia/` still exists with all files

### Requirement: Ubicación de datos portable y gestionada por el SO

The system MUST resolve all data paths via `platformdirs` so the catalog, thumbnails, and registry live under `~/Library/Application Support/Alejandria/` on macOS.

#### Scenario: Los datos de la app siguen la convención del SO

- GIVEN the user is `me` on macOS
- CUANDO the app starts
- ENTONCES `libraries/`, `thumbnails/`, and `libraries.json` are under `~/Library/Application Support/Alejandria/`

## Cross-references

- Depends on: `packaging` (portable path helper)
- Consumed by: every other capability
- New dep: `nas-catalog-service` (registry mirrored to `libraries` table)