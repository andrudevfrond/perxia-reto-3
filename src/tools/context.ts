export type ConfirmacionPendiente = {
  caso: string
  codigos: string[]
}

export type ContextoHerramienta = {
  directory: string
  sessionId: string
  source?: "demo" | "agent"
  userMessage?: string
  awaitingConfirmation?: ConfirmacionPendiente | null
  clearConfirmation?: () => void
}

export function esAfirmativo(mensaje: string): boolean {
  const texto = mensaje.trim().toLowerCase()
  return /^(s[ií]|confirmo|confirmado|procede[r]?|adelante|ok|de acuerdo|apruebo|autorizo|cr[eé]ala|crear)\b/.test(texto)
}
