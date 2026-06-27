# Especificación de Anotaciones

## Propósito

Stores all user-generated study material (highlights, notes) per file in a per-library `annotations` table with a device-agnostic REST API. v1 uses last-write-wins sync because the user is a single person who may use Mac and iPad but does not write at the same instant; conflicts resolve by `updated_at`.

## Requisitos

### Requisito: Tabla de anotaciones por biblioteca

Each library MUST contain an `annotations` table with the schema:
```
(id, file_id, type [highlight|note], page_or_position, color, text,
 body_markdown, position_x, position_y, width, height,
 use_handwritten_font, created_at, updated_at, device_id)
```
The table MUST live in the per-library SQLite DB. `type='highlight'` rows MUST have `page_or_position` and `text` and `color` set; `type='note'` rows (which include sticky-notes) MUST have `page_or_position`, `body_markdown`, `position_x`, `position_y`, `width`, `height`, and `use_handwritten_font` set.

#### Escenario: La fila de anotación persiste entre reinicios de la app

- DADO a highlight row exists in `annotations`
- CUANDO the app is killed and restarted
- ENTONCES the row is still present in the same library's DB
- Y the highlight is restored in the reader

#### Escenario: La fila de anotación está acotada a una biblioteca

- DADO the same file is cataloged in two libraries `A` and `B`
- CUANDO the user creates a highlight on the file in library `A`
- ENTONCES the row lives in `libraries/<A-uuid>.db`
- Y library `B`'s DB has no row for it

### Requisito: API REST para anotaciones

The system MUST expose at least these endpoints, all device-agnostic (JSON in / JSON out):

- `GET /api/libraries/<library_id>/files/<file_id>/annotations` → list annotations for the file
- `POST /api/libraries/<library_id>/files/<file_id>/annotations` → create
- `PUT /api/libraries/<library_id>/annotations/<annotation_id>` → update
- `DELETE /api/libraries/<library_id>/annotations/<annotation_id>` → delete

The same endpoints MUST be used by the Mac UI and the iPad Safari client; there is no separate API surface.

#### Escenario: GET devuelve anotaciones para un archivo

- DADO 3 highlights and 1 note exist for `book-042.pdf` in library `A`
- CUANDO the iPad issues `GET /api/libraries/A/files/<fid>/annotations`
- ENTONCES the response lists all 4 annotations with their fields
- Y the response is `200 OK` with a JSON array body

#### Escenario: POST crea una nueva anotación

- DADO the user drags-to-highlight on the iPad
- CUANDO the client POSTs the highlight payload (color, page, offset, length, text, device_id)
- ENTONCES the server inserts a row in `annotations`
- Y the response is `201 Created` with the new row including server-generated `id`, `created_at`, `updated_at`

#### Escenario: DELETE elimina una anotación

- DADO an annotation with id `42` exists
- CUANDO the client issues `DELETE /api/libraries/<id>/annotations/42`
- ENTONCES the row is deleted
- Y the response is `204 No Content`

### Requisito: Sync con last-write-wins

When the same annotation is updated from two devices, the server MUST keep the row with the latest `updated_at`. v1 has no merge UI; the system MUST NOT prompt the user.

#### Escenario: Una actualización concurrente mantiene la última

- DADO annotation id `42` exists with `updated_at = T0`
- CUANDO the Mac PUTs the row at `T1 > T0` and the iPad PUTs the same row at `T2 > T1`
- ENTONCES the server stores the row from `T2`
- Y the `T1` write is overwritten

#### Escenario: La escritura más vieja se rechaza silenciosamente

- DADO annotation id `42` has `updated_at = T2`
- CUANDO a stale client PUTs the row with `updated_at = T1 < T2`
- ENTONCES the server keeps `T2`'s version
- Y the stale client receives `200 OK` with the current server state (not an error)

### Requisito: Payload JSON device-agnostic

The annotation JSON payload MUST NOT contain device-specific identifiers except the optional `device_id` field used for diagnostics. The same JSON MUST be usable by Mac, iPad, or any future client.

#### Escenario: Mac e iPad producen payloads idénticos

- DADO a highlight on page 7 with text `mitochondria`
- CUANDO created from the Mac and recreated from the iPad with the same parameters
- ENTONCES both POSTs send equivalent JSON bodies (modulo `device_id` and timestamps)

### Requisito: El alcance de las anotaciones es por archivo

Annotations MUST be scoped to a `(library_id, file_id)` pair; cross-file or cross-library annotations are out of scope for v1.

#### Escenario: El mismo archivo en dos bibliotecas tiene anotaciones independientes

- DADO the same PDF is indexed in libraries `A` and `B`
- CUANDO the user creates a highlight in `A`
- ENTONCES library `B` shows no highlight for the same PDF
- Y deleting the annotation in `A` does NOT affect `B`

## Referencias cruzadas

- Depends on: `library-registry` (per-library DB), `pdf-reader` / `epub-reader` (consumers)
- Consumed by: `ipad-access` (sync transport)