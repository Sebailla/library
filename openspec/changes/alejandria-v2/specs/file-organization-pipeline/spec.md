# file-organization-pipeline Specification

## Purpose

Reorganises a messy initial NAS dump into the canonical `raw/{Apellido}, {Nombre}/` layout using a deterministic two-pass strategy: read-only analysis (proposed moves + dedupe decisions) followed by a dry-run preview, and only then an explicit execute step. Auto-renames files based on extracted metadata when confidence is high; routes low-confidence cases to `.needs_review/` so the user can approve, edit, or reject.

## Requirements

### Requirement: Two-pass pipeline with explicit dry-run

The pipeline MUST expose `POST /api/admin/organize/analyze` and `POST /api/admin/organize/execute` as two separate endpoints. The analyze step MUST NOT move any file; the execute step MUST require a `plan_id` returned by a previous analyze step. The execute step MUST refuse to run if the plan is older than 24 hours unless the client passes `force=true`.

#### Scenario: Analyze produces a plan without moving files

- GIVEN the NAS has 50,000 files in a messy layout
- WHEN the admin calls `POST /api/admin/organize/analyze`
- THEN the response is `{plan_id, summary, sample_moves[]}` with no filesystem changes
- AND no row in `books` is updated

#### Scenario: Execute requires a plan

- GIVEN no analyze step has been run
- WHEN the admin calls `POST /api/admin/organize/execute`
- THEN status is `400` and the body is `{error: {code: "NO_PLAN", ...}}`

### Requirement: Deduplication by content hash

The pipeline MUST compute the xxhash of every file. Files with identical hashes MUST be considered duplicates. The keeper MUST be chosen by quality rule: format (EPUB > PDF-text > MOBI > DOCX > PDF-scanned), then size, then metadata completeness, then human-readable filename. Losers MUST be moved to `.duplicates/<hash[:8]>/`.

#### Scenario: Two identical PDFs dedupe to one keeper

- GIVEN `book.pdf` (12 MB) and `book-copy.pdf` (12 MB) have identical content
- WHEN analyze runs
- THEN the plan proposes `book.pdf` as canonical and `book-copy.pdf` → `.duplicates/abc12345/`
- AND execute moves `book-copy.pdf` to that folder

#### Scenario: Same book in EPUB and PDF keeps both

- GIVEN `book.epub` and `book.pdf` have the same title+author but different content hashes
- WHEN analyze runs
- THEN the plan keeps both as distinct book rows referencing the same `book_id`

### Requirement: Confidence-weighted auto-rename

For each file with extractable metadata, the pipeline MUST compute `title_confidence`, `author_confidence`, `year_confidence` in `[0.0, 1.0]`. If the global confidence is `>= 0.85`, the file is auto-renamed to `{Apellido}, {Nombre} - {Título} ({Año}).{ext}` and moved to the right author folder. If between `0.60` and `0.85`, the proposed name is recorded but the file is left in place until approved via admin UI. If `< 0.60`, the file is moved to `.needs_review/<basename>`.

#### Scenario: High-confidence PDF is auto-renamed

- GIVEN a PDF with extracted metadata at confidence `0.92`
- WHEN execute runs
- THEN the file lives at `raw/Tolkien, J.R.R./El Hobbit (1937).pdf`
- AND `books.rename_strategy = 'auto'`

#### Scenario: Low-confidence PDF is parked for review

- GIVEN a PDF named `scan001.pdf` with no extractable metadata
- WHEN execute runs
- THEN the file lives at `.needs_review/scan001.pdf`
- AND `books.rename_strategy = 'failed'`

### Requirement: Idempotent execution

Re-running execute on the same plan_id MUST be a no-op (every file is already at its proposed path). Re-running analyze on the same source tree MUST return a plan that proposes zero moves when the filesystem already matches the convention.

#### Scenario: Second execute is a no-op

- GIVEN execute already ran on `plan_id = "abc"`
- WHEN the admin calls execute again with the same plan_id
- THEN zero files are moved and zero DB rows change

#### Scenario: Re-analyze on a clean tree returns empty plan

- GIVEN all files already match the canonical layout
- WHEN analyze runs again
- THEN `summary.moves_proposed = 0` and `sample_moves = []`

### Requirement: Corrupt and unsupported files are quarantined

Files that fail format validation (zip-broken EPUB, pymupdf-unreadable PDF, unknown extension) MUST be moved to `.corrupt/<basename>` with `scan_status = 'corrupt'`. Unsupported-but-known formats (`.lit`, `.rb`, `.pdb`) MUST be moved to `.unsupported/<basename>` with `scan_status = 'unsupported'`. Neither category MUST appear in `/api/search` results.

#### Scenario: Corrupt EPUB is quarantined

- GIVEN `bad.epub` fails zip integrity
- WHEN execute runs
- THEN `bad.epub` lives at `.corrupt/bad.epub`
- AND `books.scan_status = 'corrupt'`
- AND `GET /api/search?q=bad` does NOT include it

## Cross-references

- Depends on: `python-sidecar-cli` (extract), `nas-catalog-service` (writes to books)
- Consumed by: admin tooling; clients never call this directly
- Replaces the MVP `file-organization-pipeline` placeholder (T50)