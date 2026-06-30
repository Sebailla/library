# Instalación completa en QNAP con Container Station

> **Versión objetivo**: alejandria-v2 v0.5.1 (backend NAS en Docker)
>
> Esta guía es paso a paso. Si algo no funciona exactamente como dice, abrí un issue en GitHub con el output del paso que falló.

---

## Tabla de contenidos

1. [Requisitos](#1-requisitos)
2. [Preparación del QNAP](#2-preparación-del-qnap)
3. [Instalación de Container Station](#3-instalación-de-container-station)
4. [Transferir el código al QNAP](#4-transferir-el-código-al-qnap)
5. [Configurar variables de entorno](#5-configurar-variables-de-entorno)
6. [Levantar los servicios](#6-levantar-los-servicios)
7. [Verificación inicial](#7-verificación-inicial)
8. [Hacer accesible desde la LAN](#8-hacer-accesible-desde-la-lan)
9. [Configurar backups](#9-configurar-backups)
10. [Configurar Tailscale (recomendado)](#10-configurar-tailscale-recomendado)
11. [Configurar pg_cron para defrag nocturno](#11-configurar-pgcron-para-defrag-nocturno)
12. [Hacer el primer pair con un dispositivo](#12-hacer-el-primer-pair-con-un-dispositivo)
13. [Configurar el escaneo inicial de la biblioteca](#13-configurar-el-escaneo-inicial-de-la-biblioteca)
14. [Configurar la app de Mac y el iPad](#14-configurar-la-app-de-mac-y-el-ipad)
15. [Mantenimiento](#15-mantenimiento)
16. [Troubleshooting QNAP](#16-troubleshooting-qnap)

---

## 1. Requisitos

### Hardware mínimo

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| Modelo QNAP | Cualquier NAS x86 con Container Station (TS-x53, TS-x73, TVS-x71, etc.) | TS-h1290FX o TVS-h1688X (10+ cores) |
| CPU | x86_64 con virtualización (VT-x) habilitada | Intel Xeon o AMD EPYC con 8+ cores |
| RAM | 8 GB (probado con 50k libros) | **16 GB mínimo para 2M libros** (recomendado 32 GB) |
| Almacenamiento | 1 TB libre para Docker images + DBs | SSD dedicado para DBs + HDD para libros |
| Red | 1 Gbps Ethernet | 1 Gbps + 10 Gbps opcional |

### Modelos QNAP soportados (verificados)

- **TS-x53 series** (TS-253, TS-453, TS-653): económico, ideal para < 50k libros
- **TS-x73 series** (TS-273, TS-473, TS-673): mid-range, ideal para 50k-500k libros
- **TVS-x71 series** (TVS-471, TVS-671, TVS-871): high-end, ideal para > 500k libros
- **TS-h1290FX / TS-h1886X**: enterprise, para 2M+ libros

**NO soportado**:
- QNAP ARM (TS-251A, TS-328): Container Station no soporta x86 images
- QNAP con menos de 4 GB de RAM: Postgres no arranca

### Software

- QTS / QuTS hero 5.0+ (recomendado QuTS hero para SSD pools)
- Container Station 2.6+ (viene preinstalado en QTS, o instalable desde App Center)
- Container Station incluye Docker Engine 24+

### Conocimientos previos

- Familiaridad con SSH y línea de comandos
- Conceptos básicos de Docker (containers, volumes, networks)
- Acceso a tu router / firewall (para abrir puertos o configurar Tailscale)

---

## 2. Preparación del QNAP

### 2.1 Configurar pool de almacenamiento

Si tenés SSDs, configurá un Qtier pool o un static SSD pool. La DB (Postgres) y Redis se benefician mucho de SSD.

**Vía QTS Web UI**:
1. Abrí `Storage & Snapshots` → `Storage/Snapshots` → `Storage Pools`
2. Creá un nuevo pool o identificá uno existente
3. Anotá el nombre del volumen (lo necesitás para los volumes de docker)

**Vía SSH** (recomendado para sysadmins):

```bash
ssh admin@<qnap-ip>
sudo -i
# Ver pools disponibles
lvdisplay | grep "LV Name"
# Típicamente tenés: /dev/mapper/cachedev0, /dev/mapper/cachedev1, etc.
```

### 2.2 Crear carpetas de datos

Vamos a crear las carpetas que va a montar Docker:

```bash
# Conectate por SSH
ssh admin@<qnap-ip>
sudo -i

# Crear estructura en el pool SSD
mkdir -p /share/alejandria/{postgres,redis,library,backups}
mkdir -p /share/biblioteca/{raw,organized}

# Permisos: el container del backend corre como usuario 1000:1000 por default
chown -R 1000:1000 /share/alejandria
chown -R 1000:1000 /share/biblioteca

# Verificar
ls -la /share/alejandria
ls -la /share/biblioteca
```

**Estructura esperada**:
```
/share/
├── alejandria/                    # Volúmenes Docker
│   ├── postgres/                  # Datos de Postgres
│   ├── redis/                     # Datos de Redis
│   ├── library/                   # (vacío, lo usa el scan local si lo necesitás)
│   └── backups/                   # Backups de Postgres
└── biblioteca/                    # Tu biblioteca de libros
    ├── raw/                       # Donde dejás los libros sin organizar
    └── organized/                 # Después de correr el organizador
```

### 2.3 Habilitar SSH

**Vía QTS Web UI**:
1. `Control Panel` → `Network & File Services` → `Telnet/SSH`
2. Marcar "Allow SSH connection" → Port 22
3. Click "Apply"

**Vía SSH** (si ya está habilitado):

```bash
ssh admin@<qnap-ip>
```

### 2.4 Reservar IP estática (recomendado)

**Vía QTS Web UI**:
1. `Control Panel` → `Network` → `Interfaces`
2. Click en el adaptador de red
3. Click "Reserve IP" en la IP del NAS
4. Anotá la IP (ej: `192.168.1.100`)

También podés hacerlo en tu router (DHCP reservation).

---

## 3. Instalación de Container Station

### 3.1 Verificar / instalar Container Station

**Vía QTS Web UI**:
1. Abrí `App Center`
2. Buscá `Container Station`
3. Si no está instalado, click "Install" y esperá
4. Una vez instalado, abrí `Container Station` desde el menú principal

### 3.2 Habilitar SSH en Container Station (para usar docker compose)

Container Station tiene su propia consola pero la línea de comandos es limitada. Para `docker compose` completo, usá SSH directo al QNAP:

```bash
ssh admin@<qnap-ip>
sudo -i

# Verificar que Docker funciona
docker --version
docker compose version
```

Deberías ver algo como:
```
Docker version 24.0.x, build xxxxx
Docker Compose version v2.x.x
```

Si no, asegurate de que Container Station esté corriendo (verificá en Web UI).

### 3.3 Configurar el socket de Docker

**Vía QTS Web UI**:
1. Abrí `Container Station` → `Settings` (icono engranaje arriba a la derecha)
2. `Docker Settings` → habilita "Expose Docker daemon on TCP socket"
3. Anotá el puerto (default 2375)
4. Click "Apply"

**Vía SSH**:

```bash
# Editar el archivo de configuración de Container Station
cat /etc/config/container-station.conf | grep -i tcp
```

Si no ves configuración TCP, podés activarlo desde la UI como dijimos arriba.

---

## 4. Transferir el código al QNAP

Hay 3 formas, en orden de preferencia:

### Opción A: Git clone (recomendado)

```bash
ssh admin@<qnap-ip>
sudo -i

# Clonar el repo en /share/alejandria-app
cd /share
git clone https://github.com/Sebailla/library.git alejandria-app
cd alejandria-app

# Verificar
ls -la
# Deberías ver: README.md, apps/, services/, packages/, etc.
```

Si el repo es privado, configurá SSH keys primero:

```bash
# Desde tu Mac, generar key si no tenés
ssh-keygen -t ed25519

# Copiar al QNAP
ssh-copy-id admin@<qnap-ip>

# Ahora el clone funciona sin password
```

### Opción B: SCP / rsync desde tu Mac

```bash
# Desde tu Mac
cd /path/to/alejandria-v2
rsync -avz --exclude='.git' --exclude='node_modules' --exclude='dist' \
  admin@<qnap-ip>:/share/alejandria-app/
```

### Opción C: Tarball

```bash
# Desde tu Mac
cd /path/to/alejandria-v2
tar czf alejandria-v2.tar.gz --exclude='.git' --exclude='node_modules' --exclude='dist' .
scp alejandria-v2.tar.gz admin@<qnap-ip>:/share/

# En el QNAP
ssh admin@<qnap-ip>
sudo -i
cd /share
tar xzf alejandria-v2.tar.gz -C alejandria-app
```

---

## 5. Configurar variables de entorno

### 5.1 Generar secrets seguros

**En el QNAP** (o en tu Mac, no importa):

```bash
# JWT secret (≥ 32 bytes aleatorios)
SECRET=$(openssl rand -hex 32)
echo "NAS_JWT_SECRET=$SECRET"

# PIN de pair (≥ 8 caracteres)
PIN="tu-pin-secreto-aqui"
echo "NAS_PAIR_PIN=$PIN"

# Anotalos en un lugar seguro (gestor de passwords)
```

### 5.2 Crear el archivo .env

**En el QNAP**:

```bash
ssh admin@<qnap-ip>
sudo -i
cd /share/alejandria-app/services/nas-backend

# Crear el archivo .env
cat > .env <<EOF
# Producción — no commitear
NODE_ENV=production
PORT=3000

# Postgres (coincide con docker-compose.yml)
DATABASE_URL=postgresql://alejandria:TU_PASSWORD_PG@postgres:5432/alejandria

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# IMPORTANTE: el backend REHUSA arrancar sin estos (fail-fast en producción)
NAS_JWT_SECRET=<pegar el secret de arriba>
NAS_PAIR_PIN=<pegar el pin de arriba>
NAS_PIN_TTL_DAYS=30
NAS_JWT_TTL_HOURS=24

# Donde están tus libros
NAS_LIBRARY_ROOT=/share/biblioteca/raw
EOF

# Permisos: solo el usuario del backend (uid 1000) puede leerlo
chown 1000:1000 .env
chmod 600 .env

# Verificar
cat .env | grep -v SECRET
```

**Importante**: el `docker-compose.yml` define algunas env vars como defaults (como `POSTGRES_USER=alejandria`, `POSTGRES_PASSWORD=alejandria`). Para producción real deberías cambiar la password de Postgres. Editá el docker-compose.yml o pasala por el `.env`.

### 5.3 Configurar passwords de Postgres (recomendado)

Editá el `docker-compose.yml` para usar una password real de Postgres:

```yaml
services:
  postgres:
    environment:
      POSTGRES_USER: alejandria
      POSTGRES_PASSWORD: <tu-password-postgres-real>  # Cambiá esto
      POSTGRES_DB: alejandria
    # ...
  
  nas-backend:
    environment:
      DATABASE_URL: postgresql://alejandria:<tu-password-postgres-real>@postgres:5432/alejandria
      # ...
```

---

## 6. Levantar los servicios

### 6.1 Build + start

```bash
cd /share/alejandria-app/services/nas-backend

# Build de las imágenes
docker compose build

# Levantar en background
docker compose up -d
```

Deberías ver algo como:
```
[+] Running 4/4
 ✔ Network alejandria_nas-backend_default  Created
 ✔ Volume "alejandria_nas-backend_alejandria-pg-data"  Created
 ✔ Volume "alejandria_nas-backend_alejandria-redis-data"  Created
 ✔ Container alejandria-postgres  Started
 ✔ Container alejandria-redis       Started
 ✔ Container alejandria-nas-backend  Started
```

### 6.2 Verificar que los containers están corriendo

```bash
docker compose ps
```

Salida esperada:
```
NAME                    IMAGE                                  STATUS
alejandria-postgres     alejandria-nas-backend-postgres        Up (healthy)
alejandria-redis         redis:7-alpine                         Up (healthy)
alejandria-nas-backend   alejandria-nas-backend-nas-backend     Up
```

### 6.3 Ver logs en tiempo real

```bash
docker compose logs -f
```

Deberías ver:
```
alejandria-nas-backend  | alejandria-nas-backend listening on :3000
alejandria-nas-backend  | Bootstrap complete
```

Ctrl+C para salir.

---

## 7. Verificación inicial

### 7.1 Health checks

```bash
# Liveness (no toca DB)
curl http://localhost:3000/livez
# → 200 {"status":"ok"}

# Readiness (toca DB)
curl http://localhost:3000/readyz
# → 200 {"status":"ok","checks":{"postgres":"ok"}}
```

### 7.2 Métricas Prometheus

```bash
curl http://localhost:3000/metrics | head -20
```

Deberías ver:
```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/livez",status="200"} 1
...
```

### 7.3 Documentación OpenAPI

```bash
# Swagger UI
open http://<qnap-ip>:3000/api/docs

# OpenAPI JSON spec
curl http://localhost:3000/api/docs-json | head
```

Deberías ver la spec con todos los endpoints documentados.

### 7.4 Inspeccionar el contenedor del backend

```bash
# Shell dentro del container
docker exec -it alejandria-nas-backend sh

# Ver variables de entorno
env | grep -E "NAS_|DATABASE|REDIS"

# Probar conectividad a Postgres
psql -h postgres -U alejandria -d alejandria -c "\dt"
# Debe listar las tablas: authors, books, book_categories, categories, devices, downloads, libraries, organize_actions, organize_plans, scan_jobs, etc.

# Salir
exit
```

Si todo está OK, el backend está corriendo correctamente.

---

## 8. Hacer accesible desde la LAN

### 8.1 Verificar IP del QNAP

```bash
hostname -I
# Ej: 192.168.1.100

ip addr show
```

### 8.2 Verificar que el puerto 3000 está abierto

```bash
# Desde el QNAP
netstat -tlnp | grep 3000
# Debe mostrar: tcp 0 0 0.0.0.0:3000 ... LISTEN

# Desde tu Mac (en la misma LAN)
nc -zv <qnap-ip> 3000
# Debe decir: Connection to <qnap-ip> 3000 port [tcp/*] succeeded!
```

Si el nc falla, el firewall del QNAP o el router está bloqueando. Configuralo:

**Vía QTS Web UI**:
1. `Control Panel` → `System` → `Security` → `Firewall`
2. Click "Add Rule" → TCP port 3000 → Allow

### 8.3 Test desde tu Mac

```bash
curl http://<qnap-ip>:3000/livez
# → 200 {"status":"ok"}
```

Si esto funciona, la Mac puede hablar con el NAS.

---

## 9. Configurar backups

### 9.1 Backup automático de Postgres (cron)

```bash
ssh admin@<qnap-ip>
sudo -i

# Crear script de backup
cat > /share/alejandria/backup.sh <<'EOF'
#!/bin/sh
set -e

BACKUP_DIR="/share/alejandria/backups"
DATE=$(date +%Y%m%d-%H%M%S)
DAYS_TO_KEEP=14

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# Backup de Postgres
docker exec alejandria-postgres pg_dump -U alejandria alejandria \
  | gzip > "$BACKUP_DIR/alejandria-postgres-$DATE.sql.gz"

# Backup de los libros (rsync a otro disco/NAS si tenés)
# rsync -avz /share/biblioteca /share/alejandria/backups/library-$DATE/

# Limpiar backups viejos (> 14 días)
find "$BACKUP_DIR" -name "alejandria-postgres-*.sql.gz" -mtime +$DAYS_TO_KEEP -delete

echo "[$(date)] Backup complete: $BACKUP_DIR/alejandria-postgres-$DATE.sql.gz"
EOF

chmod +x /share/alejandria/backup.sh
chown admin:administrator /share/alejandria/backup.sh
```

### 9.2 Programar backup diario (crontab)

```bash
# Editar crontab del usuario
sudo -i
crontab -e

# Agregar esta línea (todos los días a las 2 AM)
0 2 * * * /share/alejandria/backup.sh >> /var/log/alejandria-backup.log 2>&1

# Guardar y salir
# (Si usás vi: Esc, :wq. Si usás nano: Ctrl+X, Y, Enter)
```

### 9.3 Probar el backup manualmente

```bash
sudo -i
/share/alejandria/backup.sh

# Verificar que se creó el archivo
ls -la /share/alejandria/backups/
```

### 9.4 Probar el restore (recomendado hacerlo una vez al año)

```bash
# Crear un contenedor Postgres temporal con el backup
docker run --rm -d \
  --name alejandria-pg-restore-test \
  -e POSTGRES_USER=alejandria \
  -e POSTGRES_PASSWORD=alejandria \
  -e POSTGRES_DB=alejandria \
  -v /share/alejandria/backups:/backups \
  postgres:16-alpine

# Esperar a que arranque
sleep 5

# Restaurar el backup
gunzip -c /share/alejandria/backups/alejandria-postgres-*.sql.gz \
  | docker exec -i alejandria-pg-restore-test psql -U alejandria -d alejandria

# Verificar que las tablas están
docker exec -it alejandria-pg-restore-test psql -U alejandria -d alejandria -c "\dt"

# Limpiar
docker stop alejandria-pg-restore-test
```

Si las tablas aparecen, tu backup es válido.

---

## 10. Configurar Tailscale (recomendado)

Tailscale te da acceso al NAS desde cualquier dispositivo (Mac, iPad, iPhone) sin abrir puertos al público. Es **altamente recomendado** sobre abrir el puerto 3000 al mundo.

### 10.1 Instalar Tailscale en el QNAP

**Vía QTS App Center**:
1. Abrí App Center
2. Buscá "Tailscale"
3. Click "Install"
4. Abrí Tailscale desde el menú principal

**Vía SSH** (alternativa):

```bash
# QNAP no tiene un binario oficial, pero podés correr Tailscale en un container
docker run -d \
  --name tailscale-qnap \
  --restart unless-stopped \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add SYS_MODULE \
  -v /var/lib/tailscale:/var/lib/tailscale \
  -v /dev/net/tun:/dev/net/tun \
  tailscale/tailscale:latest

# Autenticar
docker exec tailscale-qnap tailscale up
# Te da una URL para abrir en el navegador
```

### 10.2 Configurar la Mac y el iPad con Tailscale

1. Descargá Tailscale en cada dispositivo: https://tailscale.com/download
2. Logueate con la misma cuenta
3. Los dispositivos se descubren automáticamente en la tailnet

### 10.3 Verificar que el NAS es accesible vía Tailscale

```bash
# Desde la Mac
ping <qnap-tailscale-name>
# O:
nslookup <qnap-tailscale-name>
# Típicamente devuelve algo como 100.x.y.z

# Probar el backend
curl http://100.x.y.z:3000/livez
```

### 10.4 Configurar la app de Mac con la URL de Tailscale

En la app, en lugar de `http://192.168.1.100:3000`, usá:
```
http://<qnap-tailscale-name>:3000
```

Tailscale encripta el tráfico, no necesitás HTTPS para localhost.

---

## 11. Configurar pg_cron para defrag nocturno

El backend incluye una migración (`migrations/011_pgroonga_defrag.sql`) que crea un job de pg_cron para defragmentar el índice de pgroonga cada noche a las 3 AM. Esto es importante para mantener performance en catálogos grandes (> 100k libros).

### 11.1 Verificar que la migración se aplicó

```bash
# Conectate al Postgres
docker exec -it alejandria-postgres psql -U alejandria -d alejandria

# Ver jobs de pg_cron
SELECT jobname, schedule, command FROM cron.job;
```

Deberías ver:
```
      jobname       | schedule |              command
------------------+-----------+------------------------------------
 pgroonga_defrag   | 0 3 * * * | SELECT pgroonga_index_defrag(...)
```

Si la consulta devuelve 0 filas, pg_cron no está instalado. Ver `Sección 16 (Troubleshooting)`.

### 11.2 Probar el defrag manualmente

```bash
docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT pgroonga_index_defrag('books_title_pgroonga_idx');"

docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT pgroonga_index_defrag('books_excerpt_pgroonga_idx');"
```

Si devuelve OK, el defrag funciona. Esto está programado para correr automáticamente cada noche.

---

## 12. Hacer el primer pair con un dispositivo

### 12.1 Promover un device a admin (opcional, recomendado)

```bash
# Conectate al Postgres
docker exec -it alejandria-postgres psql -U alejandria -d alejandria

# Listar devices actuales
SELECT device_id, device_name, paired_at, is_admin FROM devices;

# Promover un device a admin
UPDATE devices SET is_admin = TRUE WHERE device_id = '<device-id-aqui>';
```

Anotá el `device_id` — lo necesitás para hacer pairing desde la app.

### 12.2 Pairing desde la app de Mac

1. Abrí la app de Mac
2. Click en "Pair with NAS"
3. Ingresá:
   - **NAS URL**: `http://<qnap-ip>:3000` (LAN) o `http://<qnap-tailscale-name>:3000` (Tailscale)
   - **PIN**: el `NAS_PAIR_PIN` que configuraste en `.env`
   - **Device name**: "MacBook Pro Oficina" (o el nombre que prefieras)
4. Click "Pair"

Deberías ver un mensaje de éxito con el `device_id`. La app guarda el JWT para futuras sesiones.

### 12.3 Verificar el pair

```bash
docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT device_id, device_name, paired_at, is_admin FROM devices;"
```

Deberías ver tu device listado.

---

## 13. Configurar el escaneo inicial de la biblioteca

### 13.1 Copiar tus libros al NAS

Desde tu Mac, copiá los libros a `/share/biblioteca/raw/`:

```bash
# Desde tu Mac
rsync -avz ~/Documents/Libros/ admin@<qnap-ip>:/share/biblioteca/raw/

# O con scp
scp -r ~/Documents/Libros/* admin@<qnap-ip>:/share/biblioteca/raw/
```

Si tenés una colección grande (decenas de miles de archivos), usá `rsync` con `--progress` y dejalo corriendo de noche.

### 13.2 Verificar permisos

```bash
# Desde el QNAP
ssh admin@<qnap-ip>
sudo -i
ls -la /share/biblioteca/raw/
# El user 1000 (que usa el container) debe poder leer
chown -R 1000:1000 /share/biblioteca
```

### 13.3 Iniciar el primer escaneo

Desde la app de Mac, andá a Settings → Library → Scan folder. Ingresá `/share/biblioteca/raw/`, elegí "Full scan" y click Start.

Alternativamente, vía API:

```bash
# Necesitás un device admin
TOKEN="<jwt-de-un-admin>"

curl -X POST http://localhost:3000/api/admin/scan/full \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"library_id": 1}'

# Ver progreso (SSE)
curl -N http://localhost:3000/api/admin/scan/events/<job_id> \
  -H "Authorization: Bearer $TOKEN"
```

Para 100k libros, el scan puede tardar varias horas. Monitoreá con `docker stats` o el dashboard de Container Station.

### 13.3 Verificar que el scan progresa

```bash
docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT id, kind, status, total_files, processed_files FROM scan_jobs ORDER BY started_at DESC LIMIT 3;"
```

Deberías ver los jobs y su progreso.

---

## 14. Configurar la app de Mac y el iPad

### 14.1 App de Mac

La app ya debería estar corriendo desde el paso 3 del manual de usuario general. Confirmá:

- Pair con el NAS (ya hecho)
- Sincronización con iCloud Drive activada (Preferencias del Sistema → Apple ID → iCloud)
- Verificá que la carpeta existe: `ls ~/Library/Mobile\ Documents/com~apple~cloudDocs/Alejandria/`

### 14.2 iPad (vía navegador)

1. Abrí Safari en el iPad
2. Andá a `http://<qnap-tailscale-name>:3001` (donde 3001 es la app web)
3. Hacé pair con el NAS (mismo PIN)
4. Las anotaciones se sincronizan vía iCloud Drive automáticamente (el iPad no necesita la app de Mac, solo iCloud)

### 14.3 iPhone / iPad (vía app Electron en desarrollo)

Por ahora la app Electron es solo para macOS. Para iOS, hay que esperar a la versión React Native (futuro).

---

## 15. Mantenimiento

### 15.1 Actualizar el backend

```bash
ssh admin@<qnap-ip>
sudo -i
cd /share/alejandria-app

# Backup antes de actualizar
/share/alejandria/backup.sh

# Pull latest
git pull origin main

# Re-build + restart
cd services/nas-backend
docker compose build
docker compose up -d
```

### 15.2 Ver logs en tiempo real

```bash
docker compose -f /share/alejandria-app/services/nas-backend/docker-compose.yml logs -f
```

### 15.3 Monitorear métricas

Si tenés Prometheus configurado (recomendado):

```yaml
# /etc/prometheus/prometheus.yml
scrape_configs:
  - job_name: 'alejandria-nas'
    scrape_interval: 15s
    static_configs:
      - targets: ['<qnap-ip>:3000']
    metrics_path: /metrics
```

Métricas clave para alertar:
- `rate(http_requests_total{status=~"5.."}[5m]) > 0.1` → 1 error cada 50s, investigate
- `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` → p95 latency > 2s
- `scan_jobs_total{status="failed"}` incrementando → jobs fallando
- `download_bytes` plateau → puede indicar que el NAS está saturado

### 15.4 Limpiar containers/images viejos

```bash
# Ver espacio usado
docker system df

# Limpiar imágenes dangling
docker image prune

# Limpiar todo lo no usado (con cuidado)
docker system prune --volumes
```

### 15.5 Actualizar el QTS (firmware del NAS)

**No** actualices el QTS arbitrariamente. Antes:

1. Verificá la compatibilidad de Container Station con la nueva versión
2. Hacé un backup completo de la config de Container Station
3. Probá primero en un NAS de test si tenés uno

Si actualizás el QTS y algo se rompe, restaurá desde el backup.

---

## 16. Troubleshooting QNAP

### 16.1 "Container Station no inicia"

**Síntoma**: La UI de Container Station no carga, o `docker` no responde por SSH.

**Diagnóstico**:
```bash
# Verificar el servicio
/etc/init.d/container-station.sh status

# Reiniciar
/etc/init.d/container-station.sh restart
```

Si no arranca, revisá:
- QNAP logs: `dmesg | tail -50`
- Container Station logs: `/var/log/container-station/`

### 16.2 "No tengo espacio en disco"

**Síntoma**: `docker compose up` falla con "no space left on device".

**Diagnóstico**:
```bash
df -h
du -sh /share/alejandria/*
```

**Fix**:
1. Borrar imágenes dangling: `docker image prune -a`
2. Borrar volúmenes huérfanos: `docker volume prune`
3. Limpiar backups viejos: `find /share/alejandria/backups -mtime +30 -delete`

### 16.3 "Postgres no arranca (pg_cron faltante)"

**Síntoma**: Container `alejandria-postgres` se reinicia en loop. Logs dicen `could not load library "pg_cron"`.

**Diagnóstico**:
```bash
docker logs alejandria-postgres | tail -20
```

**Causa**: Tu imagen de Postgres no incluye pg_cron. El `Dockerfile.pg` lo agrega, pero si configuraste para usar la imagen upstream directo, no está.

**Fix**: Asegurate de estar usando el `Dockerfile.pg` (ver paso 6.1):
```bash
cd /share/alejandria-app/services/nas-backend
docker compose build postgres
docker compose up -d postgres
```

O instalá pg_cron manualmente (workaround):
```bash
docker exec -it --user root alejandria-postgres bash
apt-get update
apt-get install -y postgresql-16-cron
docker restart alejandria-postgres
```

### 16.4 "El backend no se conecta a Postgres"

**Síntoma**: `alejandria-nas-backend` logs dicen `Error: connect ECONNREFUSED 10.0.0.x:5432`.

**Diagnóstico**:
```bash
# Verificar que postgres está corriendo
docker ps | grep postgres

# Verificar la red de Docker
docker network ls
docker network inspect <compose-network-name>
```

**Causas comunes**:
- Postgres no terminó de arrancar: esperá 10 segundos y reintentá
- `DATABASE_URL` mal configurado en `.env`
- Network mode `host` mal configurado

**Fix**:
```bash
# Ver logs de postgres
docker logs alejandria-postgres | tail -20

# Reiniciar todo
cd /share/alejandria-app/services/nas-backend
docker compose restart
```

### 16.5 "Los volúmenes no persisten después de reboot"

**Síntoma**: Pierdo los datos de Postgres cada vez que reinicio el QNAP.

**Causa**: Los volúmenes Docker están en `/var/lib/docker/volumes/` que está en el storage del sistema, no en tu pool. En QNAP los volúmenes se guardan en `/share/CACHEDEV1_DATA/.qpkg/container-station/`.

**Fix**: Verificá que los volúmenes están en `/share/` (no en el storage interno):
```bash
docker volume inspect alejandria-pg-data | grep Mountpoint
# Debe estar en /share/, no en /var/
```

Si está en `/var/`, mové los datos:
```bash
docker compose down
sudo cp -a /var/lib/docker/volumes/alejandria-pg-data /share/alejandria/
# Editar docker-compose.yml para montar /share/alejandria/postgres en /var/lib/postgresql/data
docker compose up -d
```

### 16.6 "Tailscale no se conecta"

**Síntoma**: El container de Tailscale no puede autenticar.

**Diagnóstico**:
```bash
docker logs tailscale-qnap
```

**Fix común**: el QNAP kernel no soporta TUN/TAP out of the box. Verificá que tu kernel tiene `CONFIG_TUN=y`:

```bash
ssh admin@<qnap-ip>
sudo -i
zcat /proc/config.gz | grep CONFIG_TUN
# Debe decir: CONFIG_TUN=y
```

Si no, necesitás un QNAP con kernel que soporte TUN (todos los modernos lo soportan, pero verificá).

### 16.7 "El rendimiento del scan es muy bajo"

**Síntoma**: 100k libros tardarían semanas.

**Diagnóstico**:
```bash
docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT count(*) FROM books;"
docker exec -it alejandria-postgres psql -U alejandria -d alejandria \
  -c "SELECT count(*) FROM scan_jobs WHERE status='done';"
```

**Optimizaciones**:
1. **SSD para Postgres**: si la DB está en HDD, movela a SSD. La diferencia es 10-100x.
2. **Más cores para workers**: editá `services/nas-backend/src/workers/workers.module.ts` y cambiá el `concurrency` de BullMQ a algo mayor (default es 1, subilo a 4-8 según tu CPU).
3. **Ajustar el chunk size del scan**: 1000 archivos por batch es un buen balance entre memory y throughput.

### 16.8 "La app web (3001) no se conecta al NAS (3000)"

**Síntoma**: La app web no muestra libros del NAS.

**Fix**: Asegurate de que:
1. La variable `ALEJANDRIA_NAS_URL` en la app web apunta a la URL correcta del NAS.
2. El firewall del NAS permite el puerto 3000 desde la IP de la Mac.
3. Si usás Tailscale, los dispositivos están en la misma tailnet.

### 16.9 "Quiero monitorear la temperatura del CPU del QNAP"

```bash
# Desde SSH
cat /sys/class/thermal/thermal_zone0/temp
# Devuelve miligrados: 50000 = 50°C

# O instalá qmonitor
ipkg install qmonitor
```

Si la temperatura sube mucho (> 70°C consistentemente), considerá:
- Limpiar los ventiladores del QNAP
- Agregar ventilación al rack
- Mover el NAS a un lugar más fresco

---

## Resumen rápido (cheatsheet)

```bash
# SSH al NAS
ssh admin@<qnap-ip>
sudo -i

# Ir al directorio de la app
cd /share/alejandria-app/services/nas-backend

# Ver estado
docker compose ps

# Ver logs
docker compose logs -f nas-backend

# Reiniciar
docker compose restart

# Backup
/share/alejandria/backup.sh

# Actualizar
cd /share/alejandria-app
git pull
cd services/nas-backend
docker compose build
docker compose up -d

# Ver métricas
curl http://localhost:3000/metrics | head

# Pair un device
curl -X POST http://localhost:3000/api/auth/pair \
  -H "Content-Type: application/json" \
  -d '{"pin":"<tu-pin>","device_name":"Mi MacBook"}'
```

---

**¿Problemas no cubiertos?** Abrí un issue en https://github.com/Sebailla/library/issues con:
- Output de `docker compose ps`
- Output de `docker logs alejandria-nas-backend | tail -50`
- Versión del QTS y modelo del QNAP
- Mensaje de error exacto