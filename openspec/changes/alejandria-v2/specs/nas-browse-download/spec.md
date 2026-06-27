# nas-browse-download Specification

## Purpose

Provides the client-side flow for browsing the NAS catalog and downloading a book into the local library. The flow pairs the device, searches and previews the book, requests a download URL, streams the file via Range, persists tracking, and runs the local indexing pipeline. Notes/highlights/progress never leave the device.

## Requirements

### Requirement: NAS pairing is the gate to browse

Until the device has a valid bearer token, the NAS browse view MUST be hidden. The "Connect to NAS" button MUST trigger the pairing flow described in `nas-discovery-auth` and store the resulting token in the OS keychain.

#### Scenario: An unpaired device sees a connect prompt

- GIVEN no token is stored in the OS keychain
- WHEN the user opens the NAS browse view
- THEN a "Connect to NAS" card is shown
- AND no HTTP call to the NAS is made

#### Scenario: A paired device shows the NAS browse UI

- GIVEN a valid token is stored
- WHEN the user opens the NAS browse view
- THEN the search bar and category tree render
- AND the first search fires

### Requirement: Search and preview via NAS API

The browse view MUST call `GET /api/search` and `GET /api/books/{id}` via `INasClient`. Book metadata returned by the NAS MUST include `id`, `title`, `author`, `year`, `format`, `categories`, and `cover_url`.

#### Scenario: Preview shows inherited categories

- GIVEN the user previews `Ficciones` on the NAS
- WHEN the preview modal opens
- THEN the categories list shows `Literatura > Cuentos > Argentino` (inherited from the NAS catalog)
- AND the "Download" button is enabled

### Requirement: Download flow records tracking and streams bytes

Clicking "Download" MUST:
1. POST `/api/downloads` and receive `{download_id, resume_supported}`.
2. Stream `GET /api/files/{id}` with Range headers.
3. Save the bytes to the local `raw/` folder under the canonical naming convention.
4. PATCH `/api/downloads/{download_id}` with the final completion status.

The local indexing pipeline MUST run after the file lands on disk.

#### Scenario: A successful download ends with a local row

- GIVEN the user clicks Download on `Ficciones`
- WHEN the flow completes
- THEN `downloads` has a new row with `completed = true`
- AND `books` has a row with `source = 'nas_download'`, `source_book_id = <nas uuid>`
- AND the file lives at `~/Library/Application Support/Alejandria/library/raw/Borges, Jorge Luis/Ficciones (1944).epub`

#### Scenario: A failed download marks the row as truncated

- GIVEN the user cancels a download mid-stream
- WHEN the client cancels the Range request
- THEN the local file is deleted
- AND PATCH `/api/downloads/{id}` is called with `completed = false, bytes_transferred = K, error = "user cancelled"`

### Requirement: Range resume on reconnect

If the connection drops mid-download, the client MUST retry with `Range: bytes=<bytes_transferred>-` (the value from the last partial write). The NAS MUST respond with `206 Partial Content` and the bytes starting at that offset.

#### Scenario: A dropped connection resumes mid-file

- GIVEN a 10 MB download is at 5 MB when Wi-Fi drops
- WHEN the client reconnects
- THEN a new request is issued with `Range: bytes=5242880-`
- AND status is `206 Partial Content`
- AND the bytes continue from offset 5 MB

### Requirement: Browse UI never accepts writes

The browse view MUST NOT offer any "upload to NAS", "edit metadata on NAS", or "delete from NAS" affordance. The view is read-only except for the Download action.

#### Scenario: No upload button exists

- GIVEN the user opens the NAS browse view
- WHEN the page renders
- THEN no button labelled "Upload", "Edit", "Delete" is present

## Cross-references

- Depends on: `nas-catalog-service` (HTTP API), `nas-discovery-auth` (pairing), `local-library-db` (write target), `download-tracking` (POST/PATCH tracking)
- Consumed by: end users browsing and downloading from the NAS
- Layered in: MVC layer 2 (Controller / Application) per refactor 04