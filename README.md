# Reto 01 · Agente "Registro como Proveedor"

Agente conversacional que lee la solicitud de un cliente, llena el formulario desde el repositorio maestro (Excel, PDF o valores para portal) y arma el paquete para firma. **Nunca inventa datos y nunca envía sin confirmación humana.**

- **Link de prueba:** https://agente-proveedor.calmwater-0e4a7472.eastus2.azurecontainerapps.io
- **Bot de Telegram:** [@periferia_proveedor_sergio_bot](https://t.me/periferia_proveedor_sergio_bot) (mismo agente; escribe `/start`)
- **Clave de acceso:** no requiere (los topes de uso protegen la clave del modelo).
- **Planteamiento de la solución:** [SOLUCION.md](SOLUCION.md)
- **Backlog del producto (Scrum):** [BACKLOG.md](BACKLOG.md), también cargado en Azure DevOps con `bun run backlog cargar`

## Requisitos

- [Bun](https://bun.sh) 1.2 o superior
- Una clave de Google Gemini (gratuita en aistudio.google.com) — solo para el chat; `demo.ts` no la necesita.

## Levantar en local (un comando)

```bash
cp .env.example .env      # y pega tu GEMINI_API_KEY en .env
bun install && bun run dev
```

Abre http://localhost:3000. Bun carga `.env` automáticamente.

## Verificación sin modelo

```bash
bun install && bun run demo.ts
```

Procesa los 4 casos de `fixtures/reto-01/casos/`, prueba los errores (caso inexistente, ruta maliciosa, plantilla corrupta, envío sin confirmación) y deja todo en `out/`. Limpia `out/` al inicio. Para reproducir vigencias con una fecha fija: `FECHA_EJECUCION=2026-09-15 bun run demo.ts`.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Sí (para el chat) | Clave del modelo. Solo en el backend. |
| `LLM_PROVIDER` | No (`gemini`) | Proveedor del adaptador. |
| `LLM_MODEL` | No (lista por defecto) | Uno o varios modelos separados por coma, en orden de preferencia. Si uno agota su cupo o está saturado, el agente usa el siguiente. |
| `LLM_THINKING` | No (`low`) | Nivel de razonamiento de Gemini; `low` reduce la latencia. |
| `PORT` | No (`3000`) | Puerto HTTP. |
| `ACCESS_KEY` | No | Si se define, el chat pide esta clave. |
| `MAX_ITERACIONES` | No (`25`) | Tope herramienta→modelo por turno. |
| `MAX_TOKENS_SESION` | No (`300000`) | Tope de tokens por sesión. |
| `MAX_TURNOS_DIA` | No (`300`) | Tope global de turnos por día. |
| `LLM_TIMEOUT_MS` | No (`60000`) | Timeout al proveedor. |
| `FECHA_EJECUCION` | No | Fija la fecha para evaluar vigencias. |

## Canal Telegram (opcional)

El mismo agente atiende por Telegram: el ciclo y las herramientas son los mismos (`src/servicio.ts`); `src/canales/telegram.ts` solo traduce mensajes. Comandos `/casos` y `/nuevo`; la confirmación se hace con botones y el bot envía el formulario, el checklist y la constancia de envío como archivos.

| Variable | Uso |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather. Sin él, el canal queda apagado. |
| `TELEGRAM_USUARIOS` | IDs autorizados separados por coma. Vacío = cualquiera, con los topes diarios del agente. |
| `TELEGRAM_WEBHOOK_SECRET` + `PUBLIC_URL` | En producción: webhook firmado (Telegram envía el secreto en cada llamada). Sin ellos, el servidor usa *polling* (local, sin URL pública). |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, tokensSesion }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` sin exponer claves |
| `GET` | `/api/casos` | Casos disponibles |
| `GET` | `/api/archivos/:caso` | Archivos generados del caso |
| `GET` | `/out/<caso>/<archivo>` | Descarga de un archivo generado |
| `POST` | `/api/telegram/webhook` | Webhook de Telegram (valida `X-Telegram-Bot-Api-Secret-Token`) |

## Estructura

```
agent/prompt.md               comportamiento (system prompt)
src/knowledge/                conocimiento del proceso + reglas parametrizables (reglas.json)
src/tools/proveedor.ts        las 5 herramientas (zod) → proveedor_<export>
src/tools/registro.ts         descubrimiento, validación, ejecución y logs de herramientas
src/tools/lib/                mapeo, generación de documentos, paquete, utilidades
src/llm/                      adaptador propio + implementación Gemini
src/agent.ts                  ciclo del agente (topes, confirmación humana)
src/servicio.ts               servicio del agente, independiente del canal (sesiones, topes)
src/server.ts                 API HTTP + front estático + webhook de Telegram
src/canales/telegram.ts       canal Telegram (webhook o polling)
web/index.html                chat (muestra cada herramienta y resalta la confirmación)
demo.ts                       herramientas sin modelo
modulo/                       bonus: agente empaquetado (generado con `bun run modulo`)
Dockerfile                    imagen para Azure Container Apps
```

## Despliegue (GitHub Actions + Azure Container Apps)

Cada `push` a `main` ejecuta `.github/workflows/imagen.yml`: verifica tipos, corre `demo.ts`, comprueba que `modulo/` esté sincronizado y publica la imagen en `ghcr.io/sergioguarin11/reto-01-guarin`. Azure Container Apps ejecuta esa imagen. La suscripción de prueba de Azure no permite construir imágenes en Azure (ACR Tasks), por eso la construcción ocurre en GitHub.

```bash
read -s K
az containerapp create -n agente-proveedor -g rg-periferia-reto \
  --environment prueba-periferia-env \
  --image ghcr.io/sergioguarin11/reto-01-guarin:latest \
  --ingress external --target-port 8080 --min-replicas 1 --max-replicas 1 \
  --secrets gemini-key="$K" \
  --env-vars GEMINI_API_KEY=secretref:gemini-key LLM_MODEL=gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.1-flash-lite,gemini-3.5-flash LLM_THINKING=low LLM_TIMEOUT_MS=90000
unset K
```

Para actualizar tras un nuevo `push`: `az containerapp update -n agente-proveedor -g rg-periferia-reto --image ghcr.io/sergioguarin11/reto-01-guarin:<sha>`.

La clave queda como *secret* de Azure: no aparece en el repositorio, la imagen ni los logs.
