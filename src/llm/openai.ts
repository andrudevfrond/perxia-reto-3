import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { HerramientaModelo, LlmAdapter, MensajeModelo, RespuestaModelo } from "./adapter.ts"

function modelo(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
}

function timeoutMs(): number {
  const valor = Number(process.env.LLM_TIMEOUT_MS)
  return Number.isFinite(valor) && valor > 0 ? valor : 60_000
}

export function redactar(texto: string): string {
  const clave = process.env.OPENAI_API_KEY
  if (!clave || !texto.includes(clave)) return texto
  return texto.split(clave).join("[redacted]")
}

function parametros(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: "openApi3" }) as Record<string, unknown>
  delete json.$schema
  return json
}

export function herramientasOpenAI(
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

type CuerpoOpenAI = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: { total_tokens?: number }
  error?: { message?: string }
}

export function crearAdaptadorOpenAI(): LlmAdapter {
  return {
    async enviar(mensajes, herramientas): Promise<RespuestaModelo> {
      const clave = process.env.OPENAI_API_KEY?.trim()
      if (!clave) {
        throw new Error("Falta OPENAI_API_KEY en el servidor. Agrégala al archivo .env y reinicia.")
      }
      let respuesta: Response
      try {
        respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clave}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs()),
          body: JSON.stringify({
            model: modelo(),
            temperature: 0,
            max_tokens: 2000,
            messages: mensajes.map(mensajeProveedor),
            tools: herramientas.map((herramienta) => ({
              type: "function",
              function: {
                name: herramienta.name,
                description: herramienta.description,
                parameters: herramienta.parameters,
              },
            })),
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
      let cuerpo: CuerpoOpenAI
      try {
        cuerpo = JSON.parse(texto) as CuerpoOpenAI
      } catch {
        throw new Error(`El proveedor respondió con un cuerpo ilegible (${respuesta.status}).`)
      }
      if (!respuesta.ok) {
        const detalle = redactar(cuerpo.error?.message || `HTTP ${respuesta.status}`)
        if (respuesta.status === 401) {
          throw new Error("La clave del modelo fue rechazada. Revisa OPENAI_API_KEY en el servidor.")
        }
        throw new Error(`El proveedor de lenguaje respondió con error: ${detalle}`)
      }
      const mensaje = cuerpo.choices?.[0]?.message
      const toolCalls = (mensaje?.tool_calls ?? []).flatMap((llamada) => {
        if (!llamada.id || !llamada.function?.name) return []
        return [{
          id: llamada.id,
          name: llamada.function.name,
          arguments: llamada.function.arguments ?? "{}",
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
