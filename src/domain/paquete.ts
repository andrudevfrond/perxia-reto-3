import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fallo, ok, type Resultado } from "./resultado.ts"
import type {
  AprobacionNormalizada,
  CorreoNormalizado,
  CotizacionNormalizada,
  FacturaNormalizada,
  Paquete,
  Solicitud,
} from "./tipos.ts"
import { esCaso, normalizarNit, parsearMonto, sumarDias } from "./texto.ts"

const DOCUMENTOS_REQUERIDOS = ["correo", "solicitud", "cotizacion", "aprobacion"] as const

export function rutaCaso(directorio: string, caso: string): string {
  return join(directorio, "fixtures", "reto-03", "solicitudes", caso)
}

async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (codigo === "ENOENT") return null
    throw error
  }
}

function numeroRequerido(valor: unknown, campo: string): Resultado<number> {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    return fallo(`El campo ${campo} de la solicitud no es un monto numérico. Pide al solicitante el archivo de nuevo.`)
  }
  return ok(valor)
}

function leerSolicitud(texto: string): Resultado<Solicitud> {
  let crudo: Record<string, unknown>
  try {
    crudo = JSON.parse(texto) as Record<string, unknown>
  } catch {
    return fallo("solicitud.json está malformado. Pide al solicitante que reenvíe la solicitud.")
  }
  const cantidad = numeroRequerido(crudo.cantidad, "cantidad")
  if (!cantidad.ok) return cantidad
  const valorUnitario = numeroRequerido(crudo.valor_unitario, "valor_unitario")
  if (!valorUnitario.ok) return valorUnitario
  const valorTotal = numeroRequerido(crudo.valor_total, "valor_total")
  if (!valorTotal.ok) return valorTotal
  const textoRequerido = (campo: string): Resultado<string> => {
    const valor = crudo[campo]
    if (typeof valor !== "string" || valor.trim() === "") {
      return fallo(`La solicitud no trae ${campo}. Pide al solicitante completar el Excel.`)
    }
    return ok(valor)
  }
  const solicitudId = textoRequerido("solicitud_id")
  if (!solicitudId.ok) return solicitudId
  const solicitante = textoRequerido("solicitante")
  if (!solicitante.ok) return solicitante
  const proveedorNombre = textoRequerido("proveedor_nombre")
  if (!proveedorNombre.ok) return proveedorNombre
  const descripcion = textoRequerido("descripcion")
  if (!descripcion.ok) return descripcion
  const centro = textoRequerido("centro_costo")
  if (!centro.ok) return centro
  const subarea = textoRequerido("subarea")
  if (!subarea.ok) return subarea
  const moneda = textoRequerido("moneda")
  if (!moneda.ok) return moneda
  const fecha = textoRequerido("fecha_solicitud")
  if (!fecha.ok) return fecha

  const solicitud: Solicitud = {
    solicitud_id: solicitudId.data,
    solicitante: solicitante.data,
    proveedor_nombre: proveedorNombre.data,
    descripcion: descripcion.data,
    centro_costo: centro.data,
    subarea: subarea.data,
    cantidad: cantidad.data,
    valor_unitario: valorUnitario.data,
    valor_total: valorTotal.data,
    moneda: moneda.data,
    fecha_solicitud: fecha.data,
  }
  if (typeof crudo.proveedor_nit === "string" && crudo.proveedor_nit.trim()) {
    solicitud.proveedor_nit = crudo.proveedor_nit
  }
  if (typeof crudo.indicador_iva === "string" && crudo.indicador_iva.trim()) {
    solicitud.indicador_iva = crudo.indicador_iva
  }
  if (typeof crudo.condiciones_pago === "string" && crudo.condiciones_pago.trim()) {
    solicitud.condiciones_pago = crudo.condiciones_pago
  }
  return ok(solicitud)
}

function referenciaCotizacion(texto: string): string | null {
  const primera = texto.split(/\r?\n/)[0] ?? ""
  const coincidencia = primera.match(/^COTIZACI[ÓO]N\s+(\S+)/i)
  return coincidencia?.[1] ?? null
}

export function refCotizacion(cotizacion: CotizacionNormalizada | null): string | null {
  if (!cotizacion) return null
  return referenciaCotizacion(cotizacion.texto)
}

function leerCotizacion(texto: string): Resultado<CotizacionNormalizada> {
  const proveedor = texto.match(/^Proveedor:\s*(.+)$/im)?.[1]?.trim()
  if (!proveedor) {
    return fallo("La cotización no indica el proveedor. Pide al solicitante el PDF de nuevo.")
  }
  const nitCrudo = texto.match(/^NIT:\s*(.+)$/im)?.[1]?.trim() ?? ""
  const totalLinea = texto.match(/TOTAL[^\n]*\b(COP|USD)\s*([\d.]+)/i)
  if (!totalLinea?.[1] || !totalLinea[2]) {
    return fallo("La cotización no trae un total numérico. Pide al solicitante el PDF de nuevo.")
  }
  const total = parsearMonto(totalLinea[2])
  if (total === null) {
    return fallo("El total de la cotización no es un monto numérico. Pide al solicitante el PDF de nuevo.")
  }
  const fecha = texto.match(/^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)?.[1] ?? null
  const dias = texto.match(/Validez de la oferta:\s*(\d+)\s*d[ií]as/i)?.[1]
  const validez = fecha && dias ? sumarDias(fecha, Number(dias)) : null
  return ok({
    proveedor,
    nit: nitCrudo ? normalizarNit(nitCrudo) : null,
    total,
    moneda: totalLinea[1].toUpperCase(),
    validez_hasta: validez,
    texto,
  })
}

function leerCorreo(texto: string): Resultado<CorreoNormalizado> {
  let crudo: Record<string, unknown>
  try {
    crudo = JSON.parse(texto) as Record<string, unknown>
  } catch {
    return fallo("correo.json está malformado. Pide al solicitante que reenvíe el correo.")
  }
  const campos = ["id", "de", "asunto", "fecha"] as const
  const valores: Record<string, string> = {}
  for (const campo of campos) {
    const valor = crudo[campo]
    if (typeof valor !== "string" || valor.trim() === "") {
      return fallo(`El correo no trae ${campo}. Pide al solicitante reenviar el mensaje.`)
    }
    valores[campo] = valor
  }
  return ok({
    id: valores.id ?? "",
    de: valores.de ?? "",
    asunto: valores.asunto ?? "",
    fecha: valores.fecha ?? "",
  })
}

function leerAprobacion(texto: string): Resultado<AprobacionNormalizada> {
  let crudo: Record<string, unknown>
  try {
    crudo = JSON.parse(texto) as Record<string, unknown>
  } catch {
    return fallo("aprobacion.json está malformado. Pide al solicitante el correo del líder de nuevo.")
  }
  if (typeof crudo.de !== "string" || typeof crudo.fecha !== "string" || typeof crudo.cuerpo !== "string") {
    return fallo("La aprobación no trae de, fecha o cuerpo. Pide al solicitante el correo del líder de nuevo.")
  }
  return ok({
    de: crudo.de,
    fecha: crudo.fecha,
    aprobado: /aprobado/i.test(crudo.cuerpo),
    texto: crudo.cuerpo,
  })
}

function leerFactura(texto: string): Resultado<FacturaNormalizada> {
  const numero = texto.match(/No\.\s*([A-Za-z0-9-]+)/)?.[1]
  const fecha = texto.match(/Fecha de emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
  const totalLinea = texto.match(/^TOTAL:\s*(?:COP|USD)\s*([\d.]+)/im)?.[1]
  if (!numero || !fecha || !totalLinea) {
    return fallo("La factura no trae número, fecha o total. Pide al solicitante el documento de nuevo.")
  }
  const total = parsearMonto(totalLinea)
  if (total === null) {
    return fallo("El total de la factura no es un monto numérico. Pide al solicitante el documento de nuevo.")
  }
  return ok({ numero, fecha, total })
}

export async function leerPaquete(directorio: string, caso: string): Promise<Resultado<Paquete>> {
  if (!esCaso(caso)) {
    return fallo("El caso debe tener la forma sol-001. No se aceptan rutas.")
  }
  const carpeta = rutaCaso(directorio, caso)
  let correoTexto: string | null
  let solicitudTexto: string | null
  let cotizacionTexto: string | null
  let aprobacionTexto: string | null
  let facturaTexto: string | null
  try {
    correoTexto = await leerTexto(join(carpeta, "correo.json"))
    solicitudTexto = await leerTexto(join(carpeta, "solicitud.json"))
    cotizacionTexto = await leerTexto(join(carpeta, "cotizacion.txt"))
    aprobacionTexto = await leerTexto(join(carpeta, "aprobacion.json"))
    facturaTexto = await leerTexto(join(carpeta, "factura.txt"))
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "no se pudo leer el paquete"
    return fallo(`No se pudo leer el caso ${caso}: ${mensaje}`)
  }

  const presentes = {
    correo: correoTexto,
    solicitud: solicitudTexto,
    cotizacion: cotizacionTexto,
    aprobacion: aprobacionTexto,
  }
  const faltantes = DOCUMENTOS_REQUERIDOS.filter((nombre) => presentes[nombre] === null)

  let correo: CorreoNormalizado | null = null
  if (correoTexto !== null) {
    const leido = leerCorreo(correoTexto)
    if (!leido.ok) return leido
    correo = leido.data
  }
  let solicitud: Solicitud | null = null
  if (solicitudTexto !== null) {
    const leida = leerSolicitud(solicitudTexto)
    if (!leida.ok) return leida
    solicitud = leida.data
  }
  let cotizacion: CotizacionNormalizada | null = null
  if (cotizacionTexto !== null) {
    const leida = leerCotizacion(cotizacionTexto)
    if (!leida.ok) return leida
    cotizacion = leida.data
  }
  let aprobacion: AprobacionNormalizada | null = null
  if (aprobacionTexto !== null) {
    const leida = leerAprobacion(aprobacionTexto)
    if (!leida.ok) return leida
    aprobacion = leida.data
  }
  let factura: FacturaNormalizada | null = null
  if (facturaTexto !== null) {
    const leida = leerFactura(facturaTexto)
    if (!leida.ok) return leida
    factura = leida.data
  }

  return ok({ correo, solicitud, cotizacion, aprobacion, factura, faltantes })
}
