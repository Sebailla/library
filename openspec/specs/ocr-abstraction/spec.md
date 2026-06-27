# Especificación de Abstracción de OCR

## Propósito

Provides text recognition for scanned PDFs and image-based books via an `OCRBackend` protocol that hides whether the work is done by macOS Vision Framework (Apple Silicon default) or Tesseract (fallback). OCR is opt-in per scan or per library and is never automatic in the MVP because batch OCR across thousands of pages would block the user.

## Requisitos

### Requisito: Protocolo OCRBackend con implementaciones plugables

The system MUST define an `OCRBackend` protocol with at least two implementations: `VisionBackend` (macOS Vision Framework, default on Apple Silicon) and `TesseractBackend` (fallback). The system MUST select an implementation via a factory that picks the best available backend at startup.

#### Escenario: Apple Silicon usa Vision

- DADO the app runs on macOS Apple Silicon
- CUANDO the OCR factory initializes
- ENTONCES `VisionBackend` is selected as the active backend
- Y Tesseract is not loaded

#### Escenario: Si Vision no está disponible se hace fallback a Tesseract

- DADO the app runs on macOS where Vision Framework is not loadable
- CUANDO the OCR factory initializes
- ENTONCES `TesseractBackend` is selected
- Y a startup log message records the fallback reason

### Requisito: OCR es opt-in, nunca automático

The system MUST NOT run OCR automatically during a normal scan. OCR MUST be triggered explicitly: either (a) per-library default toggle set by the user, or (b) per-scan opt-in flag. The system MUST document this opt-in behavior in the README.

#### Escenario: El escaneo por defecto saltea el OCR

- DADO a library with no per-library OCR toggle set
- CUANDO the user runs "Scan"
- ENTONCES OCR is NOT invoked for any file
- Y scanned PDFs are indexed as PDFs (no text-layer extraction via OCR)

#### Escenario: El usuario habilita OCR para una biblioteca

- DADO the user toggles "Run OCR on scanned pages" ON for library `Papers`
- CUANDO the user runs "Scan" on `Papers`
- ENTONCES OCR is invoked on scanned PDFs and image-based books during extraction
- Y the OCR text is added to the indexed row

### Requisito: OCR devuelve texto y nivel de confianza

Each OCR invocation MUST return extracted text and a confidence score. Files below a configurable confidence threshold MAY be flagged for manual review or marked as low-quality in the indexed row.

#### Escenario: OCR devuelve texto

- DADO a scanned PDF page is fed to the active backend
- CUANDO the backend processes it
- ENTONCES it returns the recognized text and a confidence score
- Y the page text is concatenated into the row's full-text index

#### Escenario: La baja confianza se registra

- DADO an OCR result with confidence `0.42` (below the default threshold of `0.6`)
- CUANDO the row is written
- ENTONCES the row is marked with a `low_ocr_confidence` flag
- Y the row is still searchable, but a UI indicator MAY show the warning

### Requisito: Override del backend de OCR por biblioteca

The system MUST allow the user to override the global default backend per library (e.g., force Tesseract for a particular library). The override MUST persist in the library's settings.

#### Escenario: El override de biblioteca supera el default global

- DADO the global default is `VisionBackend`
- CUANDO the user sets library `Papers` to use `TesseractBackend`
- ENTONCES OCR on `Papers` uses Tesseract
- Y other libraries still use Vision

## Referencias cruzadas

- Standalone: OCR is not on the critical scan path
- Depends on: macOS Vision Framework (Apple Silicon); Tesseract binary optional