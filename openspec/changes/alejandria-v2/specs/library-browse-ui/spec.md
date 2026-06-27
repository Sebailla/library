# library-browse-ui Specification

## Purpose

Renders the user's local library as a browsable grid + sidebar tree: an "Authors" column showing `{Apellido}, {Nombre}` folders, a "Categories" column showing the bilingual hierarchy, and a main grid of book covers. Built on top of `local-library-db` for the local source and `nas-catalog-service` for optional NAS overlay. Pure RSC for the initial render.

## Requirements

### Requirement: Three-column browse layout

The browse view MUST render three columns at desktop widths: (1) a left "Authors" tree, (2) a "Categories" tree, (3) a main grid of book covers. At narrower widths the two side columns MUST collapse into a hamburger drawer.

#### Scenario: Desktop layout shows all three columns

- GIVEN the user opens `/library/browse` on a 1440 px wide window
- WHEN the page renders
- THEN the three columns are visible side by side
- AND the main grid shows the covers for the selected author or category

#### Scenario: Narrow layout collapses the side columns

- GIVEN the user opens `/library/browse` on an iPad in portrait (768 px)
- WHEN the page renders
- THEN only the main grid is visible
- AND a hamburger icon is in the header
- AND tapping the hamburger reveals the authors + categories drawer

### Requirement: RSC for initial grid

The browse page MUST be a React Server Component that reads from `local-library-db` on the server. The initial HTML MUST include the first 30 covers; further pagination is handled by a Client Component fetch-on-scroll.

#### Scenario: First paint includes covers

- GIVEN the user opens the browse view with 1,200 books in "Borges, Jorge Luis"
- WHEN the page is requested
- THEN the initial HTML contains 30 `<img>` tags pointing to cover paths
- AND no JS roundtrip is required to see them

#### Scenario: Infinite scroll fetches more covers

- GIVEN the user has scrolled past the first 30 covers
- WHEN the Intersection Observer fires
- THEN the Client Component fetches the next 30 rows
- AND appends them to the grid

### Requirement: Selecting an author filters the grid

Clicking an author row MUST update the URL to `/library/browse?author=<id>` and the grid MUST refetch the filtered set. Browser back/forward MUST restore the prior filter.

#### Scenario: Clicking Borges filters the grid

- GIVEN the user is on `/library/browse`
- WHEN they click the "Borges, Jorge Luis" author row
- THEN the URL becomes `/library/browse?author=<borges-id>`
- AND the grid shows only Borges's books

#### Scenario: Back navigation restores prior state

- GIVEN the user was on the unfiltered browse, then clicked Borges
- WHEN they press the browser back button
- THEN the URL and grid return to the unfiltered view

### Requirement: Selecting a category recursively filters the grid

Clicking a category node MUST filter the grid to books that have the category OR any descendant category. The matching category IDs MUST come from a recursive CTE on the local DB.

#### Scenario: Selecting "Biología" includes Zoología books

- GIVEN "Zoología" is a descendant of "Biología" with 12 books
- WHEN the user clicks "Biología" in the categories tree
- THEN the grid shows the union of all books under "Biología" and below (e.g., 250 books including the 12 from Zoología)

### Requirement: Cover fallback to procedural placeholder

If the local row has `cover_path = NULL` or the cover file is missing on disk, the grid MUST render a procedural SVG placeholder with the book title and author. The placeholder MUST be deterministic (same hash → same image).

#### Scenario: A book without a cover shows the placeholder

- GIVEN a row has `cover_path = NULL`
- WHEN the grid renders
- THEN a procedural SVG with the title and author text appears
- AND the SVG is generated server-side and inlined in the HTML

## Cross-references

- Depends on: `local-library-db` (SQLite), `nextjs-app-shell` (App Router, RSC, cover API)
- Consumed by: end users browsing their library
- Layered in: MVC layer 1 (View) per refactor 04