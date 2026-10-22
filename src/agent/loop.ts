import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { LlmAdapter } from "../llm/adapter.ts"
import { herramientasModelo, redactar } from "../llm/gemini.ts"
import { aJson, fallo } from "../domain/resultado.ts"
import { ejecutarHerramienta, listarHerramientas } from "../tools/registry.ts"
import { cargarSesion, guardarSesion, type LlamadaVista, type Sesion } from "./session.ts"

function limiteIteraciones(): number {
  const valor = Number(process.env.MAX_TOOL_ITERATIONS)
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 25
}

function limiteTokens(): number {
  const valor = Number(process.env.MAX_SESSION_TOKENS)
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 80_000
}

async function sistema(directorio: string): Promise<string> {
  const prompt = await readFile(join(directorio, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(directorio, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt.trim()}\n\n---\n\n${conocimiento.trim()}\n`
}

function datos(resultado: string): { ok: boolean; data: Record<string, unknown> | null } {
  try {
    const json = JSON.parse(resultado) as { ok?: boolean; data?: Record<string, unknown> }
    return { ok: json.ok === true, data: json.data ?? null }
  } catch {
    return { ok: false, data: null }
  }
}

function casoDe(argumentos: string): string | null {
  try {
    const json = JSON.parse(argumentos) as { caso?: unknown }
    return typeof json.caso === "string" ? json.caso : null
  } catch {
    return null
  }
}

export async function atenderTurno(
  directorio: string,
  sessionId: string,
  mensaje: string,
  adapter: LlmAdapter,
): Promise<{ reply: string; toolCalls: LlamadaVista[]; needsConfirmation: boolean }> {
  const sesion: Sesion = await cargarSesion(directorio, sessionId)
  sesion.transcript.push({ role: "user", content: mensaje })
  sesion.turns.push({ role: "user", content: mensaje })

  const paraModelo = herramientasModelo(listarHerramientas())

  const llamadasTurno: LlamadaVista[] = []
  let reply = ""
  let creado = false
  let validacionTurno: { caso: string; codigos: string[] } | null = null
  let vioValidacion = false

  try {
    if (sesion.tokensUsed >= limiteTokens()) {
      reply = "Se alcanzó el tope de tokens de esta sesión. Abre una conversación nueva para seguir."
    } else {
      const prompt = await sistema(directorio)
      for (let iteracion = 0; iteracion < limiteIteraciones(); iteracion += 1) {
        const respuesta = await adapter.enviar(
          [{ role: "system", content: prompt }, ...sesion.transcript],
          paraModelo,
        )
        sesion.tokensUsed += respuesta.totalTokens > 0
          ? respuesta.totalTokens
          : Math.ceil(JSON.stringify(sesion.transcript).length / 4)

        if (respuesta.toolCalls.length === 0) {
          reply = redactar(respuesta.content?.trim() || "No obtuve una respuesta del modelo. Reformula la solicitud.")
          sesion.transcript.push({ role: "assistant", content: reply })
          break
        }

        sesion.transcript.push({
          role: "assistant",
          content: respuesta.content,
          toolCalls: respuesta.toolCalls,
        })

        for (const llamada of respuesta.toolCalls) {
          let args: unknown = null
          let resultado: string
          try {
            args = JSON.parse(llamada.arguments || "{}") as unknown
            resultado = await ejecutarHerramienta(llamada.name, args, {
              directory: directorio,
              sessionId,
              source: "agent",
              userMessage: mensaje,
              awaitingConfirmation: sesion.awaitingConfirmation,
              clearConfirmation: () => {
                sesion.awaitingConfirmation = null
              },
            })
          } catch (error) {
            const texto = error instanceof Error ? error.message : "No pude ejecutar la herramienta."
            resultado = aJson(fallo(redactar(texto)))
          }
          const visto = datos(resultado)
          llamadasTurno.push({
            name: llamada.name,
            arguments: args,
            result: resultado,
            ok: visto.ok,
          })
          sesion.transcript.push({
            role: "tool",
            content: resultado,
            toolCallId: llamada.id,
          })

          if (llamada.name === "oc_validar") {
            vioValidacion = true
            const caso = casoDe(llamada.arguments)
            const confirmaciones = visto.data?.confirmaciones
            const codigos = Array.isArray(confirmaciones)
              ? confirmaciones.flatMap((item) => {
                if (item && typeof item === "object" && "codigo" in item && typeof item.codigo === "string") {
                  return [item.codigo]
                }
                return []
              })
              : []
            if (caso) validacionTurno = { caso, codigos }
          }
          if (llamada.name === "oc_crear" && visto.ok && visto.data && typeof visto.data.numero_oc === "string") {
            creado = true
          }
        }

        if (iteracion === limiteIteraciones() - 1) {
          reply = "Llegué al tope de iteraciones de este turno. Esto es lo que alcancé a consultar; falta cerrar el caso si aún no hay número de orden."
          sesion.transcript.push({ role: "assistant", content: reply })
        }
      }
    }
  } catch (error) {
    const texto = error instanceof Error ? error.message : "El modelo falló."
    reply = redactar(texto)
    sesion.transcript.push({ role: "assistant", content: reply })
  }

  if (creado) {
    sesion.awaitingConfirmation = null
  } else if (vioValidacion && validacionTurno && validacionTurno.codigos.length > 0) {
    sesion.awaitingConfirmation = validacionTurno
  } else if (vioValidacion) {
    sesion.awaitingConfirmation = null
  }

  const needsConfirmation = sesion.awaitingConfirmation !== null && !creado
  sesion.turns.push({
    role: "assistant",
    content: reply,
    toolCalls: llamadasTurno,
    needsConfirmation,
  })
  await guardarSesion(directorio, sesion)
  return { reply, toolCalls: llamadasTurno, needsConfirmation }
}
