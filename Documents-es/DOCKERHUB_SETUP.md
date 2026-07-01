# Publicación en Docker Hub — setup y uso

Este documento cubre cómo se publica la imagen `alejandria-nas-backend`
en Docker Hub, cómo configurar los secretos de GitHub Actions, y cómo
usar la imagen publicada en producción.

> **TL;DR** — una vez configurados los dos secretos del repo, cada
> tag `v*` pusheado a `Sebailla/library` produce automáticamente una
> imagen multi-arquitectura en
> `docker.io/sebailla001/alejandria-nas-bockend:vX.Y.Z`.

---

## 1. Qué se publica

| Origen | Artefacto | Trigger |
|--------|-----------|---------|
| `.github/workflows/docker-publish.yml` | `docker.io/sebailla001/alejandria-nas-bockend` (linux/amd64 + linux/arm64) | push de cualquier tag `v*`, o `workflow_dispatch` para builds manuales |

La imagen:

- Se construye desde `services/nas-backend/Dockerfile` (multi-stage,
  node 20, sin root).
- Lleva anotaciones OCI (title, source, version, revision, created
  date) para que `docker inspect` y Docker Hub muestren la
  procedencia.
- Expone un `HEALTHCHECK` contra el endpoint `/livez` existente, así
  Container Station / Compose / Kubernetes pueden sondearla sin auth.
- Usa `provenance: false` (evita fricción de attestation SLSA para un
  proyecto personal).
- Pushea `latest` **solo** en builds desde `main`. Los tags de release
  quedan inmutables por versión, así nunca pisamos un release viejo
  por accidente.

---

## 2. Setup único

Necesitás dos secretos en el repo de GitHub. Cargalos en:

`https://github.com/Sebailla/library/settings/secrets/actions`

### 2.1 Crear un access token de Docker Hub

1. Iniciá sesión en <https://hub.docker.com> (creá una cuenta si no
   tenés — el plan gratuito alcanza; los repos no necesitan ser
   privados).
2. Andá a **Account settings → Security → Personal access tokens** (o
   seguí <https://hub.docker.com/settings/security>).
3. Click en **Generate new token**.
4. Description: `github-actions-alejandria-nas-backend`.
5. Permisos: como mínimo **Read & Write** (el workflow solo pushea,
   nunca borra).
6. Click en **Generate** y copiá el token — Docker Hub lo muestra
   una sola vez.

### 2.2 Cargar los dos secretos en GitHub

En **Settings → Secrets and variables → Actions** del repo, agregá:

| Nombre | Valor | Notas |
|--------|-------|-------|
| `DOCKERHUB_USERNAME` | Tu usuario de Docker Hub (`sebailla001`) | No es el email, es el username. |
| `DOCKERHUB_TOKEN` | El access token del paso 2.1 | Tratalo como contraseña — no lo pegues en ningún otro lado. |

No uses la contraseña de la cuenta de Docker Hub — los access tokens
son revocables y se pueden reemitir de forma independiente del
workflow.

---

## 3. Verificar que el workflow corre

### 3.1 Smoke test manual (sin tag)

1. Abrí la pestaña **Actions** en el repo de GitHub:
   <https://github.com/Sebailla/library/actions>.
2. Seleccioná **docker-publish** a la izquierda.
3. Click en **Run workflow** → **Run workflow** (el input `ref`
   default es el SHA de la corrida actual, así que el build usa `HEAD`
   de la branch elegida).
4. Elegí `develop` para no pisar `latest` por accidente.
5. Mirá la corrida — debería loguearse en Docker Hub, compilar las
   dos arquitecturas, y pushear.

### 3.2 Release por tag

Una vez que estés conforme, taggeá un release:

```bash
git checkout develop
git pull --ff-only
git tag v0.5.2
git push origin v0.5.2
```

En pocos minutos el workflow pushea
`sebailla001/alejandria-nas-bockend:v0.5.2` y, si el tag está en
`main`, también actualiza `sebailla001/alejandria-nas-bockend:latest`.

### 3.3 Confirmar que la imagen está

```bash
docker manifest inspect sebailla001/alejandria-nas-bockend:v0.5.1 | jq .
```

Deberías ver dos entradas: `linux/amd64` y `linux/arm64`.

---

## 4. Usar la imagen publicada

### 4.1 Quick start (host con Docker)

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://USER:PASS@HOST:5432/alejandria \
  -e REDIS_HOST=HOST \
  -e NAS_JWT_SECRET="$(openssl rand -base64 48)" \
  -e NAS_PAIR_PIN="$(openssl rand -base64 16)" \
  sebailla001/alejandria-nas-bockend:v0.5.1
curl http://localhost:3000/livez   # → "ok"
```

### 4.2 Con el `docker-compose.yml` del proyecto

`services/nas-backend/docker-compose.yml` ya pinea el servicio
`nas-backend` a:

```yaml
image: sebailla001/alejandria-nas-bockend:v0.5.1
```

Así que `docker compose up` en cualquier host con Docker sale andando:

```bash
cd services/nas-backend
docker compose up -d        # pull v0.5.1, corre postgres + redis + la API
curl http://localhost:3000/livez
```

Para usar otro tag localmente editá la línea en `docker-compose.yml`
o exportá una variable antes de subir:

```bash
TAG=v0.5.2 docker compose up -d
```

(El archivo actual pinea literalmente `v0.5.1`; bumpearlo es una
edición de una línea en `develop`.)

### 4.3 En un QNAP (Container Station)

1. Abrí Container Station → **Images** → buscá
   `sebailla001/alejandria-nas-bockend`.
2. Hacé pull de `v0.5.1`.
3. Creá un container con el puerto `3000` publicado y las cuatro
   variables de entorno de arriba.
4. El `HEALTHCHECK` interno de la imagen hace que el indicador de
   Container Station ande sin configuración extra.

Para el walkthrough completo de QNAP + Container Station ver
`Documents-es/QNAP_INSTALL.md`.

---

## 5. Troubleshooting

| Síntoma | Causa | Fix |
|---------|-------|-----|
| `Error response from daemon: Get "https://registry-1.docker.io/v2/": unknown: malformed HTTP Authorization header` (falla el step `log in to Docker Hub`) | Una de tres: (1) `DOCKERHUB_USERNAME` está vacío o mal (tiene que ser el **username**, no el email); (2) `DOCKERHUB_TOKEN` está vacío o revocado — el access token de §2.1 tiene que estar pegado **sin** comillas ni espacios; (3) usaste la password de la cuenta en lugar de un personal access token (Docker Hub bloquea passwords planas en la API de registry en la mayoría de las cuentas). | Abrí **Settings → Secrets and variables → Actions** e inspeccioná ambos valores. Re-emití un access token fresco en Docker Hub y sobrescribí `DOCKERHUB_TOKEN` (usá `gh secret set` desde la CLI o la UI web — nunca lo pegues en chat ni commits). |
| El workflow falla con `unauthorized: access denied` o `requested access to the resource is denied` | El token no tiene scope **Read & Write**, o el usuario no es dueño del repo destino (`sebailla001/alejandria-nas-bockend`) | En Docker Hub, regenerá el access token con el scope correcto. Si el usuario realmente no es dueño del repo, cambiá `DOCKERHUB_USERNAME` y el nombre de la imagen en `.github/workflows/docker-publish.yml` (líneas 5 y 8) a la cuenta que sí lo sea. |
| El workflow falla con `tag already exists` | Dos pushes corriendo contra el mismo tag `v*` | Los tags son inmutables en Docker Hub — bump a la próxima versión, nunca repushees un tag existente. |
| `latest` no se actualizó | El build no era desde `main` (los tags de release nunca setean `latest`) | Pusheá el tag desde `main`, o dispará un `workflow_dispatch` desde `main`. |
| `pull access denied for sebailla001/alejandria-nas-bockend` local | Typo en el nombre (`bockend` vs `backend`) | El nombre es intencionalmente `nas-bockend` (typo del lado del registry) — matchealo exactamente. |
| El host ARM64 no puede pull-ear la imagen | El tag publicado es anterior a la migración multi-arch | Re-pull — los tags actuales traen `linux/amd64` y `linux/arm64`. |
| Warning `Node.js 20 is deprecated` en los logs del workflow | La toolchain default del runner es Node 20; la deprecation es solo informativa | Bumpeá `actions/checkout`, `docker/setup-qemu-action`, `docker/setup-buildx-action` y `docker/build-push-action` a `v5`/`v6` (ya hecho en el workflow actual). La build de la imagen sigue usando `node:20-bookworm-slim` dentro de Docker — esa imagen base Node 20 sigue soportada por un buen tiempo. |

---

## 6. Referencias

- Workflow source: `.github/workflows/docker-publish.yml`
- Dockerfile: `services/nas-backend/Dockerfile`
- Compose stack: `services/nas-backend/docker-compose.yml`
- Manual de instalación en QNAP (español): `Documents-es/QNAP_INSTALL.md`
- Endpoint `/livez`: `services/nas-backend/src/health/health.controller.ts`