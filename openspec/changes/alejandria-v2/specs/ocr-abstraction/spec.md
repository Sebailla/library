# Delta for ocr-abstraction

## MODIFIED Requirements

### Requirement: Protocolo OCRBackend con implementaciones plugables

The system MUST define an `OCRBackend` protocol with `VisionBackend` (macOS Vision Framework, default on Apple Silicon), `TesseractBackend` (fallback), `UnlimitedOcrBackend` (cloud, opt-in), and `VisionKitBackend` (iOS-style document scanner). The factory MUST pick the best available at startup.

(Previously: two backends. v2 adds Unlimited-OCR and Vision Kit. Per-library override still allowed.)

#### Scenario: Apple Silicon usa Vision

- DADO the app runs on Apple Silicon
- CUANDO the OCR factory initializes
- ENTONCES `VisionBackend` is selected
- AND Tesseract is not loaded

#### Scenario: Si Vision no está disponible se hace fallback a Tesseract

- DADO the app runs where Vision is not loadable
- CUANDO the factory initializes
- ENTONCES `TesseractBackend` is selected

### Requirement: OCR es opt-in, nunca automático

The system MUST NOT run OCR automatically during a normal scan. OCR MUST be triggered explicitly via per-library toggle or per-scan opt-in. The system MUST document this in the README.

(Previously: opt-in only. v2 keeps opt-in but adds an automatic post-extraction OCR fallback for scanned PDFs whose extracted text is <500 characters. Disabled if `OCR_DISABLE_AUTO = true`.)

#### Scenario: El escaneo por defecto saltea el OCR

- DADO no per-library OCR toggle set
- CUANDO the user runs "Scan"
- ENTONCES OCR is NOT invoked for any file

#### Scenario: El usuario habilita OCR para una biblioteca

- DADO the user toggles OCR ON for `Papers`
- CUANDO "Scan" runs on `Papers`
- ENTONCES OCR is invoked on scanned PDFs and image-based books

### Requirement: OCR devuelve texto y nivel de confianza

Each OCR invocation MUST return text and a confidence score. Low-confidence rows MAY be flagged for manual review.

(Previously: text + confidence. v2 keeps the contract; confidence is consumed by `isbn-resolution-pipeline` layer 6 and by the FTS pipeline.)

#### Scenario: OCR devuelve texto

- DADO a scanned PDF page is fed to the active backend
- CUANDO the backend processes it
- ENTONCES it returns text and a confidence score
- AND the page text is concatenated into the row's full-text index

#### Scenario: La baja confianza se registra

- DADO an OCR result with confidence `0.42` (< 0.6 threshold)
- CUANDO the row is written
- ENTONCES the row is marked `low_ocr_confidence`
- AND the row is still searchable

### Requirement: Override del backend de OCR por biblioteca

The system MUST allow per-library override of the default backend. The override MUST persist.

(Previously: override persists in library settings. v2 also surfaces the override on the NAS via the `library_settings` Postgres table.)

#### Scenario: El override de biblioteca supera el default global

- DADO default is `VisionBackend`
- CUANDO the user sets `Papers` to use `TesseractBackend`
- ENTONCES OCR on `Papers` uses Tesseract
- AND other libraries still use Vision

## ADDED Requirements

### Requirement: Unlimited-OCR cloud backend is opt-in

The system MUST include a `UnlimitedOcrBackend` that calls `UNLIMITED_OCR_ENDPOINT`. If the env var is unset, the backend MUST NOT be registered. The factory MUST pick it after a <0.7 confidence Vision run.

#### Scenario: Unlimited-OCR auto-selected after low-confidence Vision

- GIVEN Vision OCR returns confidence `0.55`
- WHEN Unlimited-OCR is configured
- THEN the cloud backend is invoked
- AND the higher-confidence result replaces the local one

#### Scenario: Unlimited-OCR unset means no fallback

- GIVEN `UNLIMITED_OCR_ENDPOINT` is unset
- WHEN Vision OCR returns confidence `0.55`
- THEN the row is written with `low_ocr_confidence = true`
- AND no cloud call is attempted

### Requirement: Vision Kit backend wrapper

The system MUST expose a `VisionKitBackend` adapter for iOS-style document-scanner flows. The adapter MUST produce the same `OCRResult` shape as `VisionBackend`.

#### Scenario: iPad document scan uses Vision Kit

- GIVEN the user is on an iPad and triggers "Scan page"
- WHEN the adapter runs
- THEN the recognised text follows the same `OCRResult` schema
- AND the row is written with `extraction_method = 'vision_kit'`

## Cross-references

- Standalone: OCR not on critical scan path
- Depends on: macOS Vision Framework; Tesseract binary optional; `UNLIMITED_OCR_ENDPOINT` optional
- New dep: `python-sidecar-cli`