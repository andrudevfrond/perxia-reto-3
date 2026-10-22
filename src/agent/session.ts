import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { MensajeModelo } from "../llm/adapter.ts"

export type LlamadaVista = {
  name: string
  arguments: unknown
  result: string
  ok: boolean
}

export type Turno =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: LlamadaVista[]; needsConfirmation: boolean }

export type Sesion = {
  id: string
  transcript: MensajeModelo[]
  turns: Turno[]
  awaitingConfirmation: { caso: string; codigos: string[] } | null
  tokensUsed: number
}

const SESION_ID = /^[A-Za-z0-9_-]{1,80}$/

export function idValido(id: string): boolean {
  return SESION_ID.test(id)
}

function ruta(directorio: string, id: string): string {
  return join(directorio, "out", "sessions", `${id}.json`)
}

export function sesionNueva(id: string): Sesion {
  return { id, transcript: [], turns: [], awaitingConfirmation: null, tokensUsed: 0 }
}

export async function cargarSesion(directorio: string, id: string): Promise<Sesion> {
  try {
    const texto = await readFile(ruta(directorio, id), "utf8")
    return JSON.parse(texto) as Sesion
  } catch (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (codigo === "ENOENT") return sesionNueva(id)
    throw error
  }
}

export async function guardarSesion(directorio: string, sesion: Sesion): Promise<void> {
  const carpeta = join(directorio, "out", "sessions")
  await mkdir(carpeta, { recursive: true })
  await writeFile(ruta(directorio, sesion.id), `${JSON.stringify(sesion, null, 2)}\n`, "utf8")
}
