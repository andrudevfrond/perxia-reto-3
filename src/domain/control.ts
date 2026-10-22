import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type FilaControl = {
  solicitud_id: string
  resultado: "creada" | "idempotente" | "bloqueada" | "pendiente"
  numero_oc: string
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
  ts: string
}

function celda(valor: string): string {
  if (/[",\n]/.test(valor)) return `"${valor.replaceAll('"', '""')}"`
  return valor
}

export async function anexarControl(directorio: string, fila: FilaControl): Promise<void> {
  const carpeta = join(directorio, "out")
  await mkdir(carpeta, { recursive: true })
  const ruta = join(carpeta, "control.csv")
  const archivo = Bun.file(ruta)
  const existe = await archivo.exists()
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    fila.retroactiva ? "true" : "false",
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    fila.ts,
  ].map(celda).join(",")
  const encabezado = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
  await appendFile(ruta, existe ? `${linea}\n` : `${encabezado}${linea}\n`, "utf8")
}

export async function anexarLog(directorio: string, evento: Record<string, unknown>): Promise<void> {
  const carpeta = join(directorio, "out")
  await mkdir(carpeta, { recursive: true })
  await appendFile(join(carpeta, "log.jsonl"), `${JSON.stringify(evento)}\n`, "utf8")
}
