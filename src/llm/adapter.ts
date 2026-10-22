export type MensajeModelo = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  toolCalls?: { id: string; name: string; arguments: string }[]
  toolCallId?: string
}

export type HerramientaModelo = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type RespuestaModelo = {
  content: string | null
  toolCalls: { id: string; name: string; arguments: string }[]
  totalTokens: number
}

export interface LlmAdapter {
  enviar(mensajes: MensajeModelo[], herramientas: HerramientaModelo[]): Promise<RespuestaModelo>
}
