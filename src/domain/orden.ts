import { z } from "zod"

export const ordenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(z.object({
    numero: z.number(),
    descripcion: z.string().max(40),
    cantidad: z.number(),
    unidad: z.enum(["UN", "H", "MES"]),
    precio_unitario: z.number(),
    centro_costo: z.string(),
    subarea: z.string(),
    indicador_iva: z.string(),
  })).min(1),
  excepciones: z.array(z.object({
    codigo: z.string(),
    detalle: z.string(),
    confirmado_por: z.string().nullable(),
  })),
})

export type OrdenCompra = z.infer<typeof ordenCompraSchema>

export type CampoTrazado = {
  valor: string | number | boolean | null
  fuente: "solicitud" | "cotizacion" | "maestro.proveedores" | "maestro.centros-costo" | "derivado"
  nota?: string
}

export type Trazabilidad = {
  solicitud_id: string
  campos: Record<string, CampoTrazado>
}
