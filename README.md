# Órdenes de compra SAP

Agente conversacional que prepara y crea órdenes de compra sobre un SAP simulado. La analista escribe el caso (`sol-001` … `sol-006`); las herramientas leen el paquete, aplican los controles y, si corresponde, devuelven el número de orden.

## Requisitos

- [Bun](https://bun.sh) 1.3 o superior
- Una clave gratuita de Gemini, solo para el chat. Se crea en [Google AI Studio](https://aistudio.google.com/apikey). `demo.ts` no la usa

## Arranque

```bash
bun install
cp .env.example .env
```

En Windows PowerShell: `Copy-Item .env.example .env`

Completa `.env` con `GEMINI_API_KEY`. El resto puede quedar vacío: el servidor usa `gemini-3.8-flash`, puerto `3000`, 25 iteraciones, 80000 tokens de sesión y 60 segundos de timeout.

```bash
bun run dev
```

Eso levanta la API en `http://127.0.0.1:3000` y el chat en `http://127.0.0.1:5173`.

## Demo sin modelo

```bash
bun run demo.ts
```

Limpia `out/`, procesa los seis casos, repite `sol-001` para mostrar la idempotencia y confirma `sol-004`, `sol-005` y `sol-006`. Termina en `OK` si los controles cuadran.

## Variables

| Variable | Uso |
|---|---|
| `GEMINI_API_KEY` | Clave del modelo. Solo en el backend. |
| `GEMINI_MODEL` | Modelo. Vacío significa `gemini-3.8-flash`. |
| `PORT` | Puerto de la API. Vacío significa `3000`. |
| `MAX_TOOL_ITERATIONS` | Tope de idas al modelo por turno. Vacío significa 25. |
| `MAX_SESSION_TOKENS` | Tope de tokens por sesión. Vacío significa 80000. |
| `LLM_TIMEOUT_MS` | Timeout del proveedor. Vacío significa 60000. |

## API

- `POST /api/chat` con `{ sessionId, message }` responde `{ reply, toolCalls, needsConfirmation }`
- `GET /api/sessions/:id` devuelve el historial
- `GET /api/health` responde `{ ok, provider, model }` y no incluye la clave

## Link de prueba

El despliegue público queda pendiente de una cuenta del candidato. Para la defensa local: `bun run dev` y abrir `http://127.0.0.1:5173`. No hay clave de acceso.

## Qué no se versiona

`node_modules/`, `out/` y `.env`. La plantilla de variables es `.env.example`.
