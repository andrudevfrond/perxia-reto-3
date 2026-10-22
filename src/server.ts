import { join } from "node:path"
import { atenderTurno } from "./agent/loop.ts"
import { cargarSesion, guardarSesion, idValido, sesionNueva } from "./agent/session.ts"
import { crearAdaptadorGemini, nombreModelo, redactar } from "./llm/gemini.ts"

const directorio = join(import.meta.dir, "..")
const adaptador = crearAdaptadorGemini()

function puerto(): number {
  const valor = Number(process.env.PORT)
  return Number.isFinite(valor) && valor > 0 ? valor : 3000
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  })
}

Bun.serve({
  hostname: "127.0.0.1",
  port: puerto(),
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "OPTIONS") return json({ ok: true })

    if (url.pathname === "/api/health" && req.method === "GET") {
      return json({ ok: true, provider: "gemini", model: nombreModelo() })
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      let body: { sessionId?: unknown; message?: unknown }
      try {
        body = await req.json() as { sessionId?: unknown; message?: unknown }
      } catch {
        return json({ reply: "El cuerpo del mensaje no es JSON.", toolCalls: [], needsConfirmation: false }, 400)
      }
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
      const message = typeof body.message === "string" ? body.message.trim() : ""
      if (!idValido(sessionId)) {
        return json({ reply: "La sesión no es válida.", toolCalls: [], needsConfirmation: false }, 400)
      }
      if (!message || message.length > 8000) {
        return json({ reply: "Escribe un mensaje de hasta 8000 caracteres.", toolCalls: [], needsConfirmation: false }, 400)
      }
      try {
        const turno = await atenderTurno(directorio, sessionId, message, adaptador)
        return json({
          reply: redactar(turno.reply),
          toolCalls: turno.toolCalls,
          needsConfirmation: turno.needsConfirmation,
        })
      } catch (error) {
        const texto = redactar(error instanceof Error ? error.message : "No se pudo completar el turno.")
        const sesion = await cargarSesion(directorio, sessionId).catch(() => sesionNueva(sessionId))
        sesion.turns.push({ role: "assistant", content: texto, toolCalls: [], needsConfirmation: false })
        await guardarSesion(directorio, sesion).catch(() => undefined)
        return json({ reply: texto, toolCalls: [], needsConfirmation: false })
      }
    }

    const sesionRuta = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sesionRuta && req.method === "GET") {
      const id = decodeURIComponent(sesionRuta[1] ?? "")
      if (!idValido(id)) return json({ error: "Sesión inválida." }, 400)
      try {
        const sesion = await cargarSesion(directorio, id)
        if (sesion.turns.length === 0 && sesion.transcript.length === 0) {
          return json({ error: "No existe la sesión." }, 404)
        }
        return json({
          id: sesion.id,
          turns: sesion.turns,
          awaitingConfirmation: sesion.awaitingConfirmation,
          tokensUsed: sesion.tokensUsed,
        })
      } catch (error) {
        const texto = redactar(error instanceof Error ? error.message : "No se pudo leer la sesión.")
        return json({ error: texto }, 500)
      }
    }

    return json({ error: "Ruta no encontrada." }, 404)
  },
})

console.log(`API de órdenes de compra en http://127.0.0.1:${puerto()}`)
