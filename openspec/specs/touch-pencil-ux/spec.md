# Especificación de UX Táctil y Apple Pencil

## Propósito

Makes the reading and annotation UI feel native on touch devices (iPad, iPhone Safari) and Apple Pencil. Uses Pointer Events instead of mouse events, `touch-action: manipulation` to disable browser interpretation of drags as scrolls / zooms, and large hit targets so highlights and notes are accurate under a finger or a Pencil.

## Requisitos

### Requisito: Pointer Events para todas las superficies interactivas

The reader and annotation UI MUST use Pointer Events (`pointerdown`, `pointermove`, `pointerup`) instead of mouse or touch events. The same code path MUST handle touch, trackpad, mouse, and Apple Pencil input.

#### Escenario: El drag táctil resalta texto

- DADO the user is on iPad viewing a PDF
- CUANDO they drag a finger across text
- ENTONCES the highlight completes via Pointer Events
- Y the same code path handles a trackpad drag on Mac

#### Escenario: El drag con Apple Pencil resalta texto

- DADO the user is on iPad viewing a PDF
- CUANDO they drag the Apple Pencil across text
- ENTONCES the drag is delivered via Pointer Events
- Y a highlight is created on release
- Y Pencil latency (30–50 ms typical in web) does not block the highlight

### Requisito: touch-action manipulation previene el zoom por doble tap

All interactive surfaces (reader text layer, sidebar, button rows) MUST set `touch-action: manipulation` so the browser does not interpret single taps as double-taps (which would zoom) and does not start scroll / pinch gestures during a drag-to-highlight.

#### Escenario: El tap no hace zoom

- DADO the user taps a button on iPad Safari
- CUANDO the tap fires
- ENTONCES the button activates
- Y the page does NOT zoom in (which it would without `touch-action: manipulation`)

#### Escenario: El drag no scrollea la página

- DADO the user drags across text on iPad
- CUANDO the drag is in progress
- ENTONCES the page does NOT scroll horizontally or vertically
- Y the highlight gesture reaches `pointerup` cleanly

### Requisito: Drag-to-highlight en menos de 200 ms p95

The drag-to-highlight gesture MUST complete (visual highlight rendered + POST to API) in under 200 ms p95. The visual feedback MUST be immediate; the network POST is fire-and-forget but the optimistic render MUST land within the budget.

#### Escenario: Latencia de drag-to-highlight

- DADO the user drags across a 30-character span on iPad
- CUANDO they release the drag
- ENTONCES the highlight is rendered within 200 ms p95
- Y the row is persisted in the background

### Requisito: Heurísticas de palm rejection

The reader MUST apply palm-rejection heuristics: touches that start near a large contact area (palm resting on screen) MUST be ignored, while Pencil input MUST always be accepted. The exact heuristic is implementation-defined but MUST NOT block normal finger taps.

#### Escenario: La entrada de palma se rechaza

- DADO the user's palm rests on the iPad screen
- CUANDO the palm produces a `pointerdown`
- ENTONCES no highlight or selection begins
- Y the user's deliberate taps still work normally

#### Escenario: El Pencil siempre se acepta

- DADO the user is using Apple Pencil
- CUANDO the Pencil produces a `pointerdown`
- ENTONCES the gesture is accepted regardless of palm heuristics
- Y drag-to-highlight works as on Mac

### Requisito: Hit targets grandes en la UI de anotaciones

The highlight color picker buttons and the note editor controls MUST have a minimum hit target of 44x44 pt (Apple HIG) so finger taps are accurate on iPad.

#### Escenario: Hit target del color picker

- DADO the highlight color picker is open on iPad
- CUANDO the user taps a color
- ENTONCES the intended color is selected
- Y no mis-tap on a neighboring color occurs at typical finger precision

### Requisito: Gesto de tap-para-abrir-archivo

Tapping a file row in the catalog MUST open the file in the reader. Double-tap MUST NOT zoom the page (prevented by `touch-action`); the second tap MUST be treated as a second single tap.

#### Escenario: El usuario hace tap en un archivo en el iPad

- DADO the catalog grid is visible
- CUANDO the user taps a file row
- ENTONCES the reader opens
- Y the page does NOT zoom in (no double-tap zoom)

### Requisito: Pinch-to-zoom en el lector (configurable)

The reader MUST allow pinch-to-zoom on the page canvas (two-finger gesture). Pinch MUST NOT trigger when a single-finger drag is in progress (highlight mode). The pinch MUST be configurable (on by default; an option to disable).

#### Escenario: El usuario hace pinch-to-zoom

- DADO the user is viewing a PDF
- CUANDO they place two fingers on the page and spread them apart
- ENTONCES the page zooms in
- Y the same gesture on the text layer does NOT scroll or zoom out

## Referencias cruzadas

- Depends on: `pdf-reader`, `epub-reader`
- Non-goal: Apple Pencil handwriting / freehand annotation is v2 (PencilKit native app); Pencil-as-touch-pointer is the only v1 use case