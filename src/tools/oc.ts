import { z } from "zod"
import { anexarControl } from "../domain/control.ts"
import { generarEvidencia } from "../domain/evidencia.ts"
import { construirOrden } from "../domain/payload.ts"
import { leerPaquete } from "../domain/paquete.ts"
import { aJson, fallo, ok } from "../domain/resultado.ts"
import { puedeCrear, validarPaquete } from "../domain/validar.ts"
import { buscarRegistro, crearSapMock } from "../sap/mock.ts"
import { esAfirmativo, type ContextoHerramienta } from "./context.ts"

const casoSchema = z.string().regex(/^sol-\d{3}$/).describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/")

async function paqueteDelCaso(directorio: string, caso: string) {
  return leerPaquete(directorio, caso)
}

export const leer_paquete = {
  description: "Lee y normaliza correo, solicitud, cotización, aprobación y factura de un caso; un archivo ausente vuelve null.",
  args: {
    caso: casoSchema,
  },
  async execute(args: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    try {
      return aJson(await paqueteDelCaso(ctx.directory, args.caso))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo leer el paquete."
      return aJson(fallo(mensaje))
    }
  },
}

export const validar = {
  description: "Valida el caso contra maestros y controles RC1 a RC10 y devuelve bloqueos, confirmaciones y derivados.",
  args: {
    caso: casoSchema,
    paquete: z.unknown().describe("Paquete devuelto por oc_leer_paquete. La herramienta relee el caso desde fixtures."),
  },
  async execute(args: { caso: string; paquete: unknown }, ctx: ContextoHerramienta): Promise<string> {
    try {
      const paquete = await paqueteDelCaso(ctx.directory, args.caso)
      if (!paquete.ok) return aJson(paquete)
      return aJson(await validarPaquete(ctx.directory, paquete.data))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo validar el caso."
      return aJson(fallo(mensaje))
    }
  },
}

export const construir_payload = {
  description: "Arma la orden de compra validada con zod y guarda la trazabilidad de cada campo en out.",
  args: {
    caso: casoSchema,
    paquete: z.unknown().describe("Paquete devuelto por oc_leer_paquete."),
    derivados: z.unknown().describe("Derivados devueltos por oc_validar."),
  },
  async execute(args: { caso: string; paquete: unknown; derivados: unknown }, ctx: ContextoHerramienta): Promise<string> {
    try {
      const paquete = await paqueteDelCaso(ctx.directory, args.caso)
      if (!paquete.ok) return aJson(paquete)
      const validacion = await validarPaquete(ctx.directory, paquete.data)
      if (!validacion.ok) return aJson(validacion)
      const construido = await construirOrden(ctx.directory, args.caso, paquete.data, validacion.data, null)
      if (!construido.ok) return aJson(construido)
      return aJson(ok({
        orden: construido.data.orden,
        trazabilidad: construido.data.ruta,
      }))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo construir el payload."
      return aJson(fallo(mensaje))
    }
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación en texto y PDF, y devuelve la ruta y el sha256 del contenido.",
  args: {
    caso: casoSchema,
  },
  async execute(args: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    try {
      const evidencia = await generarEvidencia(ctx.directory, args.caso)
      if (!evidencia.ok) return aJson(evidencia)
      return aJson(ok({ ruta: evidencia.data.ruta, rutaPdf: evidencia.data.rutaPdf, sha256: evidencia.data.sha256 }))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo generar la evidencia."
      return aJson(fallo(mensaje))
    }
  },
}

export const crear = {
  description: "Crea la orden en el SAP simulado solo si el caso está apto y las confirmaciones ya fueron aceptadas.",
  args: {
    caso: casoSchema,
    payload: z.unknown().describe("OrdenCompra devuelta por oc_construir_payload. La orden persistida se recalcula desde fixtures."),
    confirmado: z.boolean().optional().describe("true solo si la analista confirmó en un turno anterior."),
  },
  async execute(
    args: { caso: string; payload: unknown; confirmado?: boolean },
    ctx: ContextoHerramienta,
  ): Promise<string> {
    try {
      const paquete = await paqueteDelCaso(ctx.directory, args.caso)
      if (!paquete.ok) return aJson(paquete)
      const validacion = await validarPaquete(ctx.directory, paquete.data)
      if (!validacion.ok) return aJson(validacion)

      const solicitudId = paquete.data.solicitud?.solicitud_id ?? args.caso
      const bloqueos = validacion.data.bloqueos.map((item) => item.codigo)
      const confirmaciones = validacion.data.confirmaciones.map((item) => item.codigo)
      const ts = new Date().toISOString()
      const filaBase = {
        solicitud_id: solicitudId,
        numero_oc: "",
        retroactiva: validacion.data.retroactiva,
        bloqueos,
        confirmaciones,
        ts,
      }

      const permiso = puedeCrear(validacion.data, args.confirmado === true)
      if (!permiso.ok) {
        const resultado = validacion.data.apta ? "pendiente" as const : "bloqueada" as const
        await anexarControl(ctx.directory, { ...filaBase, resultado })
        return aJson(permiso)
      }

      if (validacion.data.confirmaciones.length > 0 && ctx.source !== "demo") {
        const pendiente = ctx.awaitingConfirmation
        const afirma = esAfirmativo(ctx.userMessage ?? "")
        if (!pendiente || pendiente.caso !== args.caso || !afirma) {
          await anexarControl(ctx.directory, { ...filaBase, resultado: "pendiente" })
          return aJson(fallo(
            "Hay confirmaciones pendientes. Pregunta a la analista y espera un mensaje afirmativo en el siguiente turno.",
          ))
        }
      }

      const existente = await buscarRegistro(ctx.directory, solicitudId)
      if (existente) {
        await anexarControl(ctx.directory, {
          ...filaBase,
          resultado: "idempotente",
          numero_oc: existente.numero_oc,
        })
        ctx.clearConfirmation?.()
        return aJson(ok({ numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente: true }))
      }

      const confirmadoPor = validacion.data.confirmaciones.length > 0 ? "analista" : null
      const construido = await construirOrden(ctx.directory, args.caso, paquete.data, validacion.data, confirmadoPor)
      if (!construido.ok) return aJson(construido)

      const creada = await crearSapMock(ctx.directory).crearOrden(construido.data.orden)
      await anexarControl(ctx.directory, {
        ...filaBase,
        resultado: "creada",
        numero_oc: creada.numero_oc,
      })
      ctx.clearConfirmation?.()
      return aJson(ok({ numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false }))
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "No se pudo crear la orden."
      return aJson(fallo(mensaje))
    }
  },
}
