# Delta for annotations

## MODIFIED Requirements

### Requirement: Tabla de anotaciones por biblioteca

Each library MUST contain an `annotations` table with the schema:
```
(id, file_id, type [highlight|note], page_or_position, color, text,
 body_markdown, position_x, position_y, width, height,
 use_handwritten_font, created_at, updated_at, device_id)
```
The table MUST live in the per-library SQLite DB. `type='highlight'` rows MUST have `page_or_position`, `text`, and `color` set; `type='note'` rows MUST have `page_or_position`, `body_markdown`, `position_x`, `position_y`, `width`, `height`, and `use_handwritten_font` set.

(Previously: per-library SQLite. v2 collapses to a single local SQLite keyed by `book_id`. Column shape and validation unchanged.)

#### Scenario: La fila de anotación persiste entre reinicios de la app

- DADO a highlight row exists in `annotations`
- CUANDO the app is killed and restarted
- ENTONCES the row is still present

#### Scenario: La fila de anotación está acotada a una biblioteca

- DADO the same file is cataloged in two libraries `A` and `B`
- CUANDO the user creates a highlight in `A`
- ENTONCES the row lives in `libraries/<A-uuid>.db` only

### Requirement: API REST para anotaciones

The system MUST expose:
- `GET /api/libraries/<library_id>/files/<file_id>/annotations`
- `POST /api/libraries/<library_id>/files/<file_id>/annotations`
- `PUT /api/libraries/<library_id>/annotations/<annotation_id>`
- `DELETE /api/libraries/<library_id>/annotations/<annotation_id>`

(Previously: REST served by FastAPI on the Mac. v2 replaces the HTTP transport with iCloud Drive JSON; the REST surface on the NAS becomes read-only.)

#### Scenario: GET devuelve anotaciones para un archivo

- GIVEN 3 highlights and 1 note for `book-042.pdf` in `A`
- CUANDO the iPad issues GET
- ENTONCES the response lists all 4 annotations

#### Scenario: POST crea una nueva anotación

- GIVEN the user drags-to-highlight on the iPad
- CUANDO the client POSTs the payload
- ENTONCES the server inserts a row
- AND the response is `201 Created`

#### Scenario: DELETE elimina una anotación

- GIVEN an annotation with id `42`
- CUANDO the client issues DELETE
- ENTONCES the row is deleted
- AND the response is `204 No Content`

### Requirement: Sync con last-write-wins

When the same annotation is updated from two devices, the system MUST keep the row with the latest `updated_at`. The system MUST NOT prompt the user.

(Previously: server-side LWW via REST. v2 keeps LWW semantics but the comparison happens locally against the iCloud Drive JSON's `updated_at`; no central server is involved.)

#### Scenario: Una actualización concurrente mantiene la última

- GIVEN annotation id `42` has `updated_at = T0`
- CUANDO the Mac PUTs at `T1 > T0` and the iPad PUTs at `T2 > T1`
- ENTONCES the row from `T2` is kept

#### Scenario: La escritura más vieja se rechaza silenciosamente

- GIVEN annotation id `42` has `updated_at = T2`
- CUANDO a stale client PUTs with `updated_at = T1 < T2`
- ENTONCES the server keeps `T2`'s version
- AND the stale client receives `200 OK` with the current server state

### Requirement: Payload JSON device-agnostic

The annotation JSON payload MUST NOT contain device-specific identifiers except the optional `device_id` field. The same JSON MUST be usable by Mac, iPad, or any future client.

#### Scenario: Mac e iPad producen payloads idénticos

- GIVEN a highlight on page 7 with text `mitochondria`
- CUANDO created from Mac and iPad with the same parameters
- ENTONCES both POSTs send equivalent JSON bodies

### Requirement: El alcance de las anotaciones es por archivo

Annotations MUST be scoped to a `(library_id, file_id)` pair; cross-file or cross-library annotations are out of scope.

(Previously: per-(library, file). v2 scopes by `book_id` only.)

#### Scenario: El mismo archivo en dos bibliotecas tiene anotaciones independientes

- GIVEN the same PDF is in libraries `A` and `B`
- CUANDO the user creates a highlight in `A`
- ENTONCES library `B` shows no highlight

## ADDED Requirements

### Requirement: Sync transport changes from HTTP to iCloud Drive

The system MUST mirror each annotation set to a JSON file in iCloud Drive at `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/activity/{notes,highlights}/<book_uuid>.json`. No NAS endpoint accepts activity writes.

#### Scenario: A new highlight appears in iCloud Drive within 5 s

- GIVEN the user creates a highlight on `book-042.epub`
- CUANDO 2 seconds pass without further edits
- THEN `highlights/<book_uuid>.json` in iCloud Drive contains the highlight
- AND the local `annotations` row is unchanged

### Requirement: NAS API for activity is read-only

`GET /api/books/{id}/activity` on the NAS MUST return book metadata only. Activity writes MUST return `405 METHOD_NOT_ALLOWED`.

#### Scenario: NAS rejects activity writes

- GIVEN any client
- CUANDO `POST /api/books/<id>/annotations` is issued
- ENTONCES status is `405` and `code = "ACTIVITY_IS_LOCAL_ONLY"`

## Cross-references

- Depends on: `library-registry`, `pdf-reader` / `epub-reader`
- Consumed by: `ipad-access`
- Transport changed: HTTP → iCloud Drive JSON; conflict resolution still LWW by `updated_at`
- New dep: `reading-activity`