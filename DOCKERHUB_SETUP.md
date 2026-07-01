# Docker Hub publishing — setup and usage

This document covers how the `alejandria-nas-backend` image is published
to Docker Hub, how to wire up the GitHub Actions secrets, and how to use
the published image in production.

> **TL;DR** — once the two GitHub repo secrets are set, every `v*` tag
> pushed to `Sebailla/library` produces a multi-arch image at
> `docker.io/sebailla001/alejandria-nas-bockend:vX.Y.Z` automatically.

---

## 1. What gets published

| Source | Artifact | Trigger |
|--------|----------|---------|
| `.github/workflows/docker-publish.yml` | `docker.io/sebailla001/alejandria-nas-bockend` (linux/amd64 + linux/arm64) | push of any `v*` tag, or `workflow_dispatch` for manual builds |

The image:

- Is built from `services/nas-backend/Dockerfile` (multi-stage, node 20-bookworm-slim, non-root).
- Carries OCI image annotations (title, source, version, revision,
  created date) so `docker inspect` and Docker Hub show provenance.
- Exposes a `HEALTHCHECK` against the existing `/livez` endpoint, so
  Container Station / Compose / Kubernetes can probe it without auth.
- Has `provenance: false` (avoids SLSA attestation friction for a
  personal project).
- Pushes `latest` **only** on main-branch builds. Release tags stay
  immutable per-version so we never silently overwrite an old release.
- Uses `actions/checkout@v5`, `docker/setup-qemu-action@v4`,
  `docker/setup-buildx-action@v4`, `docker/login-action@v3`,
  `docker/build-push-action@v6` to avoid the Node 20 deprecation
  warning on the GitHub Actions runner.

---

## 2. One-time setup

You need two GitHub repo secrets. Add them at:

`https://github.com/Sebailla/library/settings/secrets/actions`

### 2.1 Create a Docker Hub access token

1. Sign in to <https://hub.docker.com> (create an account if you don't
   have one yet — pick the free tier; private repos aren't required for
   this image).
2. Go to **Account settings → Security → Personal access tokens** (or
   follow <https://hub.docker.com/settings/security>).
3. Click **Generate new token**.
4. Description: `github-actions-alejandria-nas-backend`.
5. Permissions: at minimum **Read & Write** (the workflow only pushes,
   never deletes).
6. Click **Generate** and copy the token — Docker Hub will only show it
   once.

### 2.2 Add the two GitHub secrets

In the repo's **Settings → Secrets and variables → Actions** page, add:

| Name | Value | Notes |
|------|-------|-------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username (`sebailla001`) | Not the email, the username. |
| `DOCKERHUB_TOKEN` | The access token from §2.1 | Treat like a password — don't paste it elsewhere. |

Don't use the Docker Hub account password — access tokens are scoped,
revocable, and the workflow can be reissued independently.

---

## 3. Verify the workflow runs

### 3.1 Manual smoke test (no tag needed)

1. Open the **Actions** tab in the GitHub repo:
   <https://github.com/Sebailla/library/actions>.
2. Select **docker-publish** on the left.
3. Click **Run workflow** → **Run workflow** (the `ref` input defaults
   to the current run's SHA, so the build uses `HEAD` of the chosen
   branch).
4. Pick `develop` so you don't accidentally overwrite `latest`.
5. Watch the run — it should log in to Docker Hub, build both
   architectures, and push.

### 3.2 Tag-driven release

Once you're happy, tag a release:

```bash
git checkout develop
git pull --ff-only
git tag v0.5.2
git push origin v0.5.2
```

Within a few minutes the workflow will push
`sebailla001/alejandria-nas-bockend:v0.5.2` and update
`sebailla001/alejandria-nas-bockend:latest` if the tag was on `main`.

### 3.3 Confirm the image landed

```bash
docker manifest inspect sebailla001/alejandria-nas-bockend:v0.5.1 | jq .
```

You should see both `linux/amd64` and `linux/arm64` entries.

---

## 4. Use the published image

### 4.1 Quick start (host with Docker)

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://USER:PASS@HOST:5432/alejandria \
  -e REDIS_HOST=HOST \
  -e NAS_JWT_SECRET="$(openssl rand -base64 48)" \
  -e NAS_PAIR_PIN="$(openssl rand -base64 16)" \
  sebailla001/alejandria-nas-bockend:v0.5.1
curl http://localhost:3000/livez   # → "ok"
```

### 4.2 With the project's `docker-compose.yml`

`services/nas-backend/docker-compose.yml` already pins the
`nas-backend` service to:

```yaml
image: sebailla001/alejandria-nas-bockend:v0.5.1
```

So `docker compose up` on any host with Docker just works:

```bash
cd services/nas-backend
docker compose up -d        # pulls v0.5.1, runs postgres + redis + the API
curl http://localhost:3000/livez
```

Override the tag locally with the `TAG` env var:

```bash
TAG=v0.5.2 docker compose up -d
```

(See `docker-compose.yml` for the exact substitution — the current file
pins the literal `v0.5.1`; bumping it is a one-line edit on `develop`.)

### 4.3 On a QNAP (Container Station)

1. Open Container Station → **Images** → search
   `sebailla001/alejandria-nas-bockend`.
2. Pull `v0.5.1`.
3. Create a container with port `3000` published and the four
   environment variables above.
4. The image's built-in `HEALTHCHECK` makes Container Station's
   status indicator work without extra configuration.

For the full QNAP + Container Station walkthrough see
`Documents-es/QNAP_INSTALL.md`.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Error response from daemon: Get "https://registry-1.docker.io/v2/": unknown: malformed HTTP Authorization header` (the `log in to Docker Hub` step fails) | One of three things: (1) `DOCKERHUB_USERNAME` is empty or wrong (must be the **username**, not the email); (2) `DOCKERHUB_TOKEN` is empty or revoked — the access token from §2.1 must be pasted in **without** quotes or trailing whitespace; (3) you used the account password instead of a personal access token (Docker Hub blocks plain passwords for registry API auth on most accounts). | Open **Settings → Secrets and variables → Actions** and inspect both values. Re-issue a fresh access token in Docker Hub and overwrite `DOCKERHUB_TOKEN` (use the `gh secret set` CLI or the web UI — never paste it in chat or commits). |
| Workflow fails with `unauthorized: access denied` or `requested access to the resource is denied` | The token does not have **Read & Write** scope, or the user does not own the target repository (`sebailla001/alejandria-nas-bockend`) | In Docker Hub, regenerate the access token with the right scope. If the user truly doesn't own the repo, change `DOCKERHUB_USERNAME` and the image name in `.github/workflows/docker-publish.yml` (lines 5 and 8) to whatever account does. |
| Workflow fails with `tag already exists` | Two pushes racing on the same `v*` tag | Tags are immutable on Docker Hub — bump to the next version, never re-push an existing tag. |
| `latest` didn't update | The build wasn't on `main` (release tags never set `latest`) | Push the tag from `main`, or trigger a `workflow_dispatch` from `main` manually. |
| `pull access denied for sebailla001/alejandria-nas-bockend` locally | Typo in the image name (`bockend` vs `backend`) | The image name is intentionally `nas-bockend` (typo on the registry side) — match it exactly. |
| ARM64 host can't pull the image | The published tag predates the multi-arch migration | Re-pull — current tags ship `linux/amd64` and `linux/arm64`. |
| Warning `Node.js 20 is deprecated` in workflow logs | The runner's default toolchain is Node 20; the deprecation warning is informational only | Bump the `actions/checkout` to `v5` and `docker/build-push-action` to `v6` (the docker setup actions are already on `v4` which is the latest available — there is no `v5`). The image build still uses `node:20-bookworm-slim` inside Docker — that Node 20 base image is still supported for the foreseeable future. |
| `Unable to resolve action docker/setup-buildx-action@v5, unable to find version v5` (or `setup-qemu-action@v5`) | A previous commit bumped those actions to `v5` but only `v3`/`v4` are published | Use `docker/setup-qemu-action@v4` and `docker/setup-buildx-action@v4` (latest published). |

---

## 6. References

- Workflow source: `.github/workflows/docker-publish.yml`
- Dockerfile: `services/nas-backend/Dockerfile`
- Compose stack: `services/nas-backend/docker-compose.yml`
- QNAP install manual (Spanish): `Documents-es/QNAP_INSTALL.md`
- `/livez` endpoint: `services/nas-backend/src/health/health.controller.ts`