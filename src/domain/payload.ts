import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { hashEvidencia } from "./evidencia.ts"
import { refCotizacion } from "./paquete.ts"
import type { OrdenCompra, Trazabilidad } from "./orden.ts"
import { ordenCompraSchema } from "./orden.ts"
import { fallo, ok, type Resultado } from "./resultado.ts"
import type { Paquete, Validacion } from "./tipos.ts"

const LIMITE_DESCRIPCION = 40

function unidadDe(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  return "UN"
}

export async function construirOrden(
  directorio: string,
  caso: string,
  paquete: Paquete,
  validacion: Validacion,
  confirmadoPor: string | null,
): Promise<Resultado<{ orden: OrdenCompra; trazabilidad: Trazabilidad; ruta: string }>> {
  const solicitud = paquete.solicitud
  const proveedor = validacion.derivados.proveedor
  const indicador = validacion.derivados.indicador_iva
  const condiciones = validacion.derivados.condiciones_pago
  if (!validacion.apta) {
    const razones = validacion.bloqueos.map((item) => item.codigo).join(", ")
    return fallo(`No se arma el payload porque hay bloqueos: ${razones}.`)
  }
  if (!solicitud || !proveedor || !indicador || !condiciones || !paquete.aprobacion || !paquete.correo) {
    return fallo("Faltan solicitud, proveedor, IVA, condiciones de pago, aprobación o correo para armar la orden.")
  }
  if (solicitud.moneda !== "COP" && solicitud.moneda !== "USD") {
    return fallo(`La moneda ${solicitud.moneda} no es COP ni USD.`)
  }

  const evidencia = await hashEvidencia(directorio, caso)
  if (!evidencia.ok) return evidencia

  const descripcionCompleta = solicitud.descripcion
  const descripcion = descripcionCompleta.slice(0, LIMITE_DESCRIPCION)
  const orden: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: refCotizacion(paquete.cotizacion),
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: proveedor.codigo_sap,
      nit: proveedor.nit,
      nombre: proveedor.nombre,
    },
    moneda: solicitud.moneda,
    condiciones_pago: condiciones.codigo,
    aprobador: {
      email: paquete.aprobacion.de,
      fecha_aprobacion: paquete.aprobacion.fecha,
      evidencia_sha256: evidencia.data,
    },
    posiciones: [{
      numero: 10,
      descripcion,
      cantidad: solicitud.cantidad,
      unidad: unidadDe(solicitud.descripcion),
      precio_unitario: solicitud.valor_unitario,
      centro_costo: solicitud.centro_costo,
      subarea: solicitud.subarea,
      indicador_iva: indicador.codigo,
    }],
    excepciones: validacion.confirmaciones.map((item) => ({
      codigo: item.codigo,
      detalle: item.mensaje,
      confirmado_por: confirmadoPor,
    })),
  }

  const parsed = ordenCompraSchema.safeParse(orden)
  if (!parsed.success) {
    return fallo(`El payload no cumple el esquema: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`)
  }

  const campos: Trazabilidad["campos"] = {
    "referencia.solicitud_id": { valor: solicitud.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: paquete.correo.id, fuente: "derivado", nota: "correo.id del paquete" },
    "referencia.cotizacion_ref": { valor: orden.referencia.cotizacion_ref, fuente: "cotizacion" },
    sociedad: { valor: "1000", fuente: "derivado", nota: "sociedad fija del diseño" },
    organizacion_compras: { valor: "1000", fuente: "derivado", nota: "organización fija del diseño" },
    "proveedor.codigo_sap": { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: proveedor.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: proveedor.nombre, fuente: "maestro.proveedores" },
    moneda: { valor: solicitud.moneda, fuente: "solicitud" },
    condiciones_pago: { valor: condiciones.codigo, fuente: condiciones.fuente === "solicitud" ? "solicitud" : "maestro.proveedores" },
    "aprobador.email": { valor: paquete.aprobacion.de, fuente: "derivado", nota: "aprobacion.de" },
    "aprobador.fecha_aprobacion": { valor: paquete.aprobacion.fecha, fuente: "derivado", nota: "aprobacion.fecha" },
    "aprobador.evidencia_sha256": { valor: evidencia.data, fuente: "derivado", nota: "sha256 del texto de aprobación" },
    "posiciones[0].numero": { valor: 10, fuente: "derivado" },
    "posiciones[0].descripcion": {
      valor: descripcion,
      fuente: "solicitud",
      ...(descripcionCompleta.length > LIMITE_DESCRIPCION
        ? { nota: `truncado a 40 caracteres. Original: ${descripcionCompleta}` }
        : {}),
    },
    "posiciones[0].cantidad": { valor: solicitud.cantidad, fuente: "solicitud" },
    "posiciones[0].unidad": { valor: orden.posiciones[0]?.unidad ?? "UN", fuente: "derivado" },
    "posiciones[0].precio_unitario": { valor: solicitud.valor_unitario, fuente: "solicitud" },
    "posiciones[0].centro_costo": { valor: solicitud.centro_costo, fuente: "solicitud" },
    "posiciones[0].subarea": { valor: solicitud.subarea, fuente: "solicitud" },
    "posiciones[0].indicador_iva": {
      valor: indicador.codigo,
      fuente: indicador.fuente === "solicitud" ? "solicitud" : "maestro.proveedores",
    },
  }

  const trazabilidad: Trazabilidad = { solicitud_id: solicitud.solicitud_id, campos }
  const carpeta = join(directorio, "out", caso)
  await mkdir(carpeta, { recursive: true })
  const ruta = join(carpeta, "trazabilidad.json")
  await writeFile(ruta, `${JSON.stringify(trazabilidad, null, 2)}\n`, "utf8")
  return ok({ orden: parsed.data, trazabilidad, ruta })
}
