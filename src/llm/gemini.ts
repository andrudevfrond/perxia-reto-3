import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { HerramientaModelo, LlmAdapter, MensajeModelo, RespuestaModelo } from "./adapter.ts"

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

function modelo(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash"
}

function timeoutMs(): number {
  const valor = Number(process.env.LLM_TIMEOUT_MS)
  return Number.isFinite(valor) && valor > 0 ? valor : 60_000
}

export function redactar(texto: string): string {
  const clave = process.env.GEMINI_API_KEY
  if (!clave || !texto.includes(clave)) return texto
  return texto.split(clave).join("[redacted]")
}

function parametros(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: "openApi3" }) as Record<string, unknown>
  delete json.$schema
  return json
}

export function herramientasModelo(
  lista: { name: string; description: string; schema: z.ZodTypeAny }[],
): HerramientaModelo[] {
  return lista.map((herramienta) => ({
    name: herramienta.name,
    description: herramienta.description,
    parameters: parametros(herramienta.schema),
  }))
}

function mensajeProveedor(mensaje: MensajeModelo): Record<string, unknown> {
  if (mensaje.role === "tool") {
    return {
      role: "tool",
      tool_call_id: mensaje.toolCallId,
      content: mensaje.content ?? "",
    }
  }
  if (mensaje.role === "assistant" && mensaje.toolCalls && mensaje.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: mensaje.content,
      tool_calls: mensaje.toolCalls.map((llamada) => ({
        id: llamada.id,
        type: "function",
        function: { name: llamada.name, arguments: llamada.arguments },
      })),
    }
  }
  return { role: mensaje.role, content: mensaje.content ?? "" }
}

type CuerpoGemini = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string | Record<string, unknown> }
      }>
    }
  }>
  usage?: { total_tokens?: number }
  error?: { message?: string }
}

function argumentos(valor: string | Record<string, unknown> | undefined): string {
  if (typeof valor === "string" && valor.trim()) return valor
  if (valor && typeof valor === "object") return JSON.stringify(valor)
  return "{}"
}

export function crearAdaptadorGemini(): LlmAdapter {
  return {
    async enviar(mensajes, herramientas): Promise<RespuestaModelo> {
      const clave = process.env.GEMINI_API_KEY?.trim()
      if (!clave) {
        throw new Error("Falta GEMINI_API_KEY en el servidor. Agrégala al archivo .env y reinicia.")
      }
      let respuesta: Response
      try {
        respuesta = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clave}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs()),
          body: JSON.stringify({
            model: modelo(),
            temperature: 0,
            max_tokens: 4096,
            reasoning_effort: "low",
            messages: mensajes.map(mensajeProveedor),
            tools: herramientas.map((herramienta) => ({
              type: "function",
              function: {
                name: herramienta.name,
                description: herramienta.description,
                parameters: herramienta.parameters,
              },
            })),
            tool_choice: "auto",
          }),
        })
      } catch (error) {
        const nombre = error instanceof Error ? error.name : ""
        if (nombre === "TimeoutError" || nombre === "AbortError") {
          throw new Error("El proveedor de lenguaje no respondió a tiempo. Puedes reintentar el mensaje.")
        }
        throw new Error("No se pudo contactar al proveedor de lenguaje. La sesión sigue activa.")
      }

      const texto = await respuesta.text()
      let cuerpo: CuerpoGemini
      try {
        cuerpo = JSON.parse(texto) as CuerpoGemini
      } catch {
        throw new Error(`El proveedor respondió con un cuerpo ilegible (${respuesta.status}).`)
      }
      if (!respuesta.ok) {
        const detalle = redactar(cuerpo.error?.message || `HTTP ${respuesta.status}`)
        if (respuesta.status === 401 || respuesta.status === 403) {
          throw new Error("La clave del modelo fue rechazada. Revisa GEMINI_API_KEY en el servidor.")
        }
        if (respuesta.status === 429) {
          throw new Error("El cupo gratuito de Gemini se agotó por ahora. Espera un momento y reintenta.")
        }
        throw new Error(`El proveedor de lenguaje respondió con error: ${detalle}`)
      }
      const mensaje = cuerpo.choices?.[0]?.message
      const toolCalls = (mensaje?.tool_calls ?? []).flatMap((llamada, indice) => {
        if (!llamada.function?.name) return []
        return [{
          id: llamada.id || `call_${indice}`,
          name: llamada.function.name,
          arguments: argumentos(llamada.function.arguments),
        }]
      })
      return {
        content: redactar(mensaje?.content ?? ""),
        toolCalls,
        totalTokens: cuerpo.usage?.total_tokens ?? 0,
      }
    },
  }
}

export function nombreModelo(): string {
  return modelo()
}
