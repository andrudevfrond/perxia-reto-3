import { buscarCentro, buscarProveedor, cargarMaestros } from "./maestros.ts"
import { refCotizacion } from "./paquete.ts"
import { ok, fallo, type Resultado } from "./resultado.ts"
import type { Derivados, Hallazgo, Paquete, Validacion } from "./tipos.ts"
import { diaIso } from "./texto.ts"

const TOLERANCIA_MONTO = 1
const TOLERANCIA_COTIZACION = 0.02

function hallazgo(codigo: string, mensaje: string, accion: string): Hallazgo {
  return { codigo, mensaje, accion }
}

export async function validarPaquete(directorio: string, paquete: Paquete): Promise<Resultado<Validacion>> {
  const maestros = await cargarMaestros(directorio)
  if (!maestros.ok) return maestros

  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const solicitud = paquete.solicitud
  if (!solicitud) {
    bloqueos.push(hallazgo(
      "RC1",
      "No hay solicitud en el paquete.",
      "Pide al solicitante el Excel de la solicitud.",
    ))
    return ok(vacio(bloqueos))
  }

  const proveedor = buscarProveedor(maestros.data, solicitud.proveedor_nit, solicitud.proveedor_nombre)
  if (!proveedor) {
    const identidad = solicitud.proveedor_nit
      ? `NIT ${solicitud.proveedor_nit}`
      : `nombre "${solicitud.proveedor_nombre}"`
    bloqueos.push(hallazgo(
      "RC1",
      `El proveedor no existe en el maestro (${identidad}).`,
      "Pide al solicitante un proveedor registrado en SAP o solicita el alta en el maestro.",
    ))
  } else if (!proveedor.activo) {
    bloqueos.push(hallazgo(
      "RC1",
      `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) está inactivo.`,
      "Pide al solicitante otro proveedor activo o la reactivación en SAP.",
    ))
  }

  const centro = buscarCentro(maestros.data, solicitud.centro_costo)
  const aprobador = centro?.aprobadores.find(
    (candidato) => candidato.email.toLowerCase() === paquete.aprobacion?.de.toLowerCase(),
  ) ?? null

  if (!paquete.aprobacion) {
    bloqueos.push(hallazgo(
      "RC2",
      "No hay correo de aprobación.",
      "Pide al solicitante el correo del líder del centro de costos.",
    ))
  } else if (!paquete.aprobacion.aprobado) {
    bloqueos.push(hallazgo(
      "RC2",
      "El correo de aprobación no contiene la palabra Aprobado.",
      "Pide al líder que responda el correo con una aprobación explícita.",
    ))
  } else if (!centro) {
    bloqueos.push(hallazgo(
      "RC2",
      `El centro de costos ${solicitud.centro_costo} no está en el maestro, así que no hay aprobadores.`,
      "Pide al solicitante el centro de costos correcto.",
    ))
  } else if (!aprobador) {
    bloqueos.push(hallazgo(
      "RC2",
      `Quien aprueba (${paquete.aprobacion.de}) no es aprobador del centro ${solicitud.centro_costo}.`,
      `Pide la aprobación de un líder de ${solicitud.centro_costo}: ${centro.aprobadores.map((item) => item.email).join(", ")}.`,
    ))
  }

  if (aprobador && solicitud.valor_total > aprobador.tope) {
    bloqueos.push(hallazgo(
      "RC3",
      `El valor ${solicitud.valor_total} supera el tope ${aprobador.tope} de ${aprobador.email}.`,
      "Pide la aprobación de un líder con tope suficiente para ese centro.",
    ))
  }

  if (!centro) {
    bloqueos.push(hallazgo(
      "RC4",
      `El centro de costos ${solicitud.centro_costo} no existe en el maestro.`,
      "Pide al solicitante un centro de costos vigente.",
    ))
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push(hallazgo(
      "RC4",
      `La subárea ${solicitud.subarea} no pertenece al centro ${solicitud.centro_costo}.`,
      `Usa una de estas subáreas: ${centro.subareas.join(", ")}.`,
    ))
  }

  if (!paquete.cotizacion) {
    confirmaciones.push(hallazgo(
      "RC5",
      "No hay cotización para comparar con la solicitud.",
      "Confirma si se crea la orden sin cotización o pide el documento al solicitante.",
    ))
  } else if (solicitud.valor_total === 0) {
    confirmaciones.push(hallazgo(
      "RC5",
      "El valor total de la solicitud es 0 y no se puede medir la diferencia con la cotización.",
      "Confirma el valor con el solicitante antes de crear la orden.",
    ))
  } else {
    const diferencia = Math.abs(paquete.cotizacion.total - solicitud.valor_total) / solicitud.valor_total
    if (diferencia > TOLERANCIA_COTIZACION) {
      const porcentaje = (diferencia * 100).toFixed(2)
      confirmaciones.push(hallazgo(
        "RC5",
        `La cotización (${paquete.cotizacion.total} ${paquete.cotizacion.moneda}) difiere de la solicitud (${solicitud.valor_total} ${solicitud.moneda}) en ${porcentaje}%, por encima del 2%.`,
        "Confirma con la analista cuál valor debe quedar en la orden. No se ajusta el monto en silencio.",
      ))
    }
  }

  let indicador: Derivados["indicador_iva"] = null
  if (solicitud.indicador_iva) {
    indicador = { codigo: solicitud.indicador_iva, fuente: "solicitud", confirmacion_requerida: false }
  } else if (proveedor?.activo) {
    indicador = {
      codigo: proveedor.indicador_iva_default,
      fuente: "maestro.proveedores",
      confirmacion_requerida: true,
    }
    confirmaciones.push(hallazgo(
      "RC6",
      `La solicitud no informa IVA. Se propone ${proveedor.indicador_iva_default}, el indicador por defecto de ${proveedor.nombre}.`,
      "Confirma ese indicador de IVA antes de crear la orden.",
    ))
  } else {
    confirmaciones.push(hallazgo(
      "RC6",
      "La solicitud no informa IVA y no hay un proveedor activo del cual derivarlo.",
      "Pide el indicador de IVA al solicitante.",
    ))
  }

  let condiciones: Derivados["condiciones_pago"] = null
  if (solicitud.condiciones_pago) {
    condiciones = { codigo: solicitud.condiciones_pago, fuente: "solicitud" }
  } else if (proveedor?.activo) {
    condiciones = { codigo: proveedor.condiciones_pago_default, fuente: "maestro.proveedores" }
  }

  let retroactiva = false
  if (paquete.factura && diaIso(paquete.factura.fecha) < diaIso(solicitud.fecha_solicitud)) {
    retroactiva = true
    confirmaciones.push(hallazgo(
      "RC8",
      `La factura ${paquete.factura.numero} tiene fecha ${paquete.factura.fecha}, anterior a la solicitud ${solicitud.fecha_solicitud}. La orden quedaría marcada como retroactiva.`,
      "Confirma si se crea la orden retroactiva. El caso se registra en el log de control.",
    ))
  }

  if (paquete.aprobacion && diaIso(paquete.aprobacion.fecha) < diaIso(solicitud.fecha_solicitud)) {
    confirmaciones.push(hallazgo(
      "RC9",
      `La aprobación (${diaIso(paquete.aprobacion.fecha)}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`,
      "Confirma que esa aprobación corresponde a esta solicitud.",
    ))
  }

  const calculado = solicitud.cantidad * solicitud.valor_unitario
  if (Math.abs(calculado - solicitud.valor_total) > TOLERANCIA_MONTO) {
    bloqueos.push(hallazgo(
      "RC10",
      `Cantidad por valor unitario (${calculado}) no cuadra con el valor total (${solicitud.valor_total}).`,
      "Pide al solicitante corregir cantidad, valor unitario o valor total.",
    ))
  }

  const derivados: Derivados = {
    proveedor: proveedor
      ? {
          codigo_sap: proveedor.codigo_sap,
          nit: proveedor.nit,
          nombre: proveedor.nombre,
          fuente: "maestro.proveedores",
        }
      : null,
    indicador_iva: indicador,
    condiciones_pago: condiciones,
    aprobador: aprobador ? { email: aprobador.email, tope: aprobador.tope } : null,
    cotizacion_ref: refCotizacion(paquete.cotizacion),
  }

  return ok({
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  })
}

function vacio(bloqueos: Hallazgo[]): Validacion {
  return {
    apta: false,
    bloqueos,
    confirmaciones: [],
    derivados: {
      proveedor: null,
      indicador_iva: null,
      condiciones_pago: null,
      aprobador: null,
      cotizacion_ref: null,
    },
    retroactiva: false,
  }
}

export function puedeCrear(validacion: Validacion, confirmado: boolean): Resultado<true> {
  if (!validacion.apta) {
    const razones = validacion.bloqueos.map((item) => `${item.codigo}: ${item.mensaje}`).join(" ")
    return fallo(`No se crea la orden. ${razones}`)
  }
  if (validacion.confirmaciones.length > 0 && !confirmado) {
    const razones = validacion.confirmaciones.map((item) => `${item.codigo}: ${item.mensaje}`).join(" ")
    return fallo(`Pendiente de confirmación. ${razones}`)
  }
  return ok(true)
}
