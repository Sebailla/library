# Cómo construir y publicar Alejandría — el pipeline de release para macOS

Este documento explica cómo convertir el `apps/mac/dist/` compilado en
el DMG firmado y notarizado que se entrega a los usuarios finales, y
cómo publicar un release que `electron-updater` pueda distribuir como
parche en caliente.

El pipeline de build tiene dos etapas:

1. `electron-forge` convierte `src/*.ts` en un app de mac ejecutable
   (scaffold ya presente en PR-4C, ver `apps/mac/forge.config.ts`).
2. `electron-builder` envuelve ese app en un DMG, lo codesigna,
   lo notariza a través del servicio de notaría de Apple, y escribe
   el manifiesto de actualización (`latest-mac.yml`) que la app en
   ejecución consulta en cada lanzamiento. La configuración vive en
   `apps/mac/electron-builder.yml`.

```
        ┌────────────────────┐
        │ npm run build      │   tsc -p tsconfig.build.json
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ npm run package    │   electron-forge package
        │   → out/Alejandría │   app plano, sin firmar
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ npm run dist       │   electron-builder --mac
        │   → release/       │   DMG + latest-mac.yml (manifiesto
        │                    │   de actualización)
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ ./scripts/verify-  │   smoke test: bundle id,
        │   dist.cjs         │   CFBundleName, ejecutable
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ gh release create  │   subir DMG + latest-mac.yml
        └────────────────────┘
```

## Prerrequisitos (configuración única)

1. **Cuenta de Apple Developer** con membresía paga del programa
   ($99/año). Tanto la codesign como la notaría la requieren.
2. Certificado **Developer ID Application** instalado en el llavero
   de tu sesión. Generalo desde
   <https://developer.apple.com/account/resources/certificates/list>.
3. **Contraseña específica de app** para `notarytool`. Generala
   desde <https://appleid.apple.com/account/manage> →
   "Contraseñas específicas de apps".
4. `electron-builder` instalado como dev dep:

   ```sh
   cd apps/mac
   npm install --save-dev electron-builder
   ```

5. Helper de CLI para construir solo los artefactos de macOS:

   ```jsonc
   // apps/mac/package.json — agregar bajo "scripts"
   "dist": "electron-builder --mac --config electron-builder.yml",
   "dist:unsigned": "electron-builder --mac --config electron-builder.yml --publish never"
   ```

## Build y verificación (cada release)

```sh
# 1. Compilar el main process de Electron
cd apps/mac
npm run build

# 2. Envolverlo en un .app de macOS mediante electron-forge
npm run package

# 3. Envolver ese .app en un DMG mediante electron-builder
#    (codesign + notaría)
CSC_LINK=/ruta/a/DeveloperID.p12 \
CSC_KEY_PASSWORD='…' \
APPLE_ID='tu@ejemplo.com' \
APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop' \
APPLE_TEAM_ID='ABCDE12345' \
  npm run dist

# 4. Smoke test del artefacto
node scripts/verify-dist.cjs ./release
```

`verify-dist.cjs` sale con código distinto de cero si
`release/Alejandria.app` no existe, si tiene un `CFBundleIdentifier`
incorrecto, o si falta el ejecutable `MacOS/alejandria`. CI lo
ejecuta después de cada `dist`.

## Detalles de codesign

`electron-builder` toma la identidad de firma de tu llavero
automáticamente cuando pasás `CSC_LINK` con la ruta al certificado
Developer ID Application (formato `p12`). Las variables de entorno
expuestas son:

| Var | Qué es | Requerida |
|-----|--------|-----------|
| `CSC_LINK` | Ruta al certificado `.p12` | Sí (local) — CI usa secrets en su lugar |
| `CSC_KEY_PASSWORD` | Contraseña del p12 | Sí cuando `CSC_LINK` está seteado |
| `CSC_NAME` | *Common name* del certificado (ej. `Developer ID Application: Sebailla (ABCDE12345)`) | Opcional; elegir del llavero si hay varios instalados |
| `APPLE_ID` | Email de Apple ID usado para la notaría | Sí |
| `APPLE_APP_SPECIFIC_PASSWORD` | La contraseña específica de app (ver paso 3 arriba) | Sí |
| `APPLE_TEAM_ID` | Identificador de equipo de 10 caracteres | Sí |

La flag `hardenedRuntime: true` en `electron-builder.yml` activa
el Hardened Runtime de macOS, requisito obligatorio de la
notaría. No la desactives.

### PR-N8: notaría bloqueante vía `xcrun notarytool submit --wait`

El pipeline end-to-end está expuesto como un único script de shell
(`apps/mac/scripts/sign-and-notarize.sh`) para que CI no tenga que
recordar el orden de las variables y herramientas. Se invoca desde
el directorio `apps/mac/`:

```sh
cd apps/mac
APPLE_ID='you@example.com' \
APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop' \
APPLE_TEAM_ID='ABCDE12345' \
CSC_LINK=/path/to/DeveloperID.p12 \
CSC_KEY_PASSWORD='…' \
  npm run dist:mac:sign
```

El script rechaza ejecutarse si falta alguna de las variables
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` o
`CSC_LINK` (cada guardia sale con `1`). Una vez sano el entorno:

1. `npm run build` — compila el bundle del main process.
2. `npm run package` — envuelve el bundle en un `.app` vía
   electron-forge.
3. `electron-builder --mac --publish never` — codesign del .app,
   construye el DMG, lo entrega al hook de notaría de
   electron-builder.
4. `xcrun notarytool submit … --wait` — BLOQUEA en el servicio de
   notaría de Apple para que el script sólo devuelva 0 después de
   emitido el ticket. El flag `--wait` es obligatorio: sin él el
   script puede disparar y olvidar un DMG cuyo ticket nunca llega
   (post-mortem PR-4D).

El script honra `ELECTRON_BUILDER_CACHE` para que el runner pueda
conservar la descarga de electron (de varios GB) entre invocaciones.

### Apple ID mockeado en los tests

`apps/mac/__tests__/sign-and-notarize.test.ts` valida el script
estáticamente (guardias presentes, flag `--wait` presente, par
electron-builder + `--publish never` presente). No requiere un
Apple ID real — son chequeos de contenido, no un intento de
codesign.

## Flujo de auto-update (`electron-updater`)

`apps/mac/electron-builder.yml` declara el target de publicación:

```yaml
publish:
  provider: github
  owner: Sebailla
  repo: library
  releaseType: release
```

Cada vez que `npm run dist` termina correctamente, electron-builder
sube `release/Alejandria-X.Y.Z.dmg` + `release/latest-mac.yml` como
un release de GitHub con el formato `vX.Y.Z`. El manifiesto YAML es
el canal que la app en ejecución consulta al iniciar:

```
GET https://github.com/Sebailla/library/releases/latest/download/latest-mac.yml
```

Si la versión que está corriendo es anterior a la del manifiesto,
`electron-updater` descarga el DMG, ejecuta `hdiutil attach` para
extraer el nuevo `.app`, y lo reemplaza en el próximo arranque. El
usuario nunca tiene que volver a arrastrar un DMG nuevo a
`/Applications/`.

### Cortar un release

```sh
# Bumpear la versión en apps/mac/package.json Y packages/mac/manifest.json
# (lo que el equipo estandarice — mantenerlos sincronizados).
git tag v0.2.0
git push origin v0.2.0

# CI: en push de tag, el workflow de release de macOS corre:
#   1. npm ci
#   2. npm run build
#   3. npm run dist          (con CSC_LINK et al. desde GitHub secrets)
#   4. node scripts/verify-dist.cjs
#   5. gh release upload      (adjunta el DMG al tag existente)
```

Si el workflow de release AÚN no está conectado, podés publicar
desde tu portátil:

```sh
cd apps/mac
npm run dist
gh release create v0.2.0 \
  release/Alejandría-0.2.0-arm64.dmg \
  release/Alejandría-0.2.0.dmg \
  release/latest-mac.yml
```

## Configuración de CI (placeholder)

El workflow de release de macOS vive en
`.github/workflows/release-mac.yml` (agregado en PR-5). Secrets
requeridos:

- `CSC_LINK` — `DeveloperID.p12` codificado en base64.
- `CSC_KEY_PASSWORD` — contraseña del p12.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — como arriba.

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `electron-builder` no encuentra la identidad de firma | El certificado no está importado en el llavero, o `CSC_NAME` no coincide | Re-importar el p12, listar certificados con `security find-identity -p codesigning -v` |
| `notarytool` devuelve "Could not find app-specific password" | `APPLE_APP_SPECIFIC_PASSWORD` sin setear o con el alcance equivocado | Regenerar la contraseña en appleid.apple.com; el email de la cuenta DEBE coincidir con `APPLE_ID` |
| El DMG instala bien pero el auto-update nunca dispara | Falta `latest-mac.yml` en el release, o está bajo otro tag | Comparar `gh release view v0.X.Y --json assets` con la URL del manifiesto arriba |
| `verify-dist.cjs` reporta mismatch de `CFBundleIdentifier` | `forge.config.ts` y `electron-builder.yml` se desincronizaron | Mantener `appBundleId`/`appId` sincronizados |
| El DMG es enorme (~250 MB) | Olvidaste marcar las deps nativas como externas | Agregar `asarUnpack` a `electron-builder.yml` |
