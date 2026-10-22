import { z, type ZodRawShape } from "zod"
import { anexarLog } from "../domain/control.ts"
import { aJson, fallo } from "../domain/resultado.ts"
import { esCaso } from "../domain/texto.ts"
import type { ContextoHerramienta } from "./context.ts"
import * as oc from "./oc.ts"

type Herramienta = {
  description: string
  args: ZodRawShape
  execute: (args: never, ctx: ContextoHerramienta) => Promise<string>
}

function esHerramienta(valor: unknown): valor is Herramienta {
  if (!valor || typeof valor !== "object") return false
  const candidata = valor as Herramienta
  return typeof candidata.description === "string"
    && typeof candidata.execute === "function"
    && typeof candidata.args === "object"
    && candidata.args !== null
}

const herramientas = new Map<string, Herramienta>()

for (const [nombre, valor] of Object.entries(oc)) {
  if (!esHerramienta(valor)) continue
  herramientas.set(`oc_${nombre}`, valor)
}

export type DefinicionPublica = {
  name: string
  description: string
  schema: z.ZodObject<ZodRawShape>
}

export function listarHerramientas(): DefinicionPublica[] {
  return [...herramientas.entries()].map(([name, herramienta]) => ({
    name,
    description: herramienta.description,
    schema: z.object(herramienta.args),
  }))
}

function resumir(resultado: string): string {
  return resultado.length > 1500 ? `${resultado.slice(0, 1500)}…` : resultado
}

export async function ejecutarHerramienta(
  nombre: string,
  args: unknown,
  ctx: ContextoHerramienta,
): Promise<string> {
  const herramienta = herramientas.get(nombre)
  let resultado: string
  if (!herramienta) {
    resultado = aJson(fallo(`Herramienta desconocida: ${nombre}`))
  } else {
    const parsed = z.object(herramienta.args).safeParse(args)
    if (!parsed.success) {
      const detalle = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      resultado = aJson(fallo(`Argumentos inválidos. ${detalle}`))
    } else {
      try {
        resultado = await herramienta.execute(parsed.data as never, ctx)
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : "La herramienta falló."
        resultado = aJson(fallo(mensaje))
      }
    }
  }

  const caso = args && typeof args === "object" && "caso" in args && typeof args.caso === "string" && esCaso(args.caso)
    ? args.caso
    : undefined
  try {
    await anexarLog(ctx.directory, {
      ts: new Date().toISOString(),
      sessionId: ctx.sessionId,
      tool: nombre,
      caso,
      args,
      result: resumir(resultado),
    })
  } catch {
    // El log no debe ocultar el resultado de la herramienta.
  }
  return resultado
}
