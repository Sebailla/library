# Generated TypeScript SDK client

This folder is generated. **DO NOT EDIT BY HAND** — re-run
`npm run openapi:generate` in `services/nas-backend/` whenever a
controller's decorators or shape change.

The single file `api.d.ts` is the typed OpenAPI 3.x surface of the
NAS backend, serialised by [openapi-typescript](https://openapi-ts.dev/).

## Usage

```ts
import type { paths } from './api';

type PairRequest =
  paths['/api/auth/pair']['post']['requestBody']['content']['application/json'];
type Pair201 =
  paths['/api/auth/pair']['post']['responses']['201']['content']['application/json'];
type Pair422 =
  paths['/api/auth/pair']['post']['responses']['422']['content']['application/json'];
```

## Regeneration

```sh
cd services/nas-backend
npm run openapi:generate       # writes clients/ts/api.d.ts
npm run openapi:check          # CI guard — fails if regeneration drifts
```

`npm run openapi:check` is what CI runs on every PR to /develop.
A failed check means a controller decorator changed without the
generated client being committed — fix by running `generate`
locally and committing the result.

## PR-N6 (issue #90)

The client is generated alongside the OpenAPI surface
(`GET /api/docs-json`) so SDK consumers in `apps/mac` and
`apps/web` can import the typed paths instead of writing
request shapes by hand.

No Co-Authored-By.
