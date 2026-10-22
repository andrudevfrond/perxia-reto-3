export type Solicitud = {
  solicitud_id: string
  solicitante: string
  proveedor_nombre: string
  proveedor_nit?: string
  descripcion: string
  centro_costo: string
  subarea: string
  cantidad: number
  valor_unitario: number
  valor_total: number
  moneda: string
  indicador_iva?: string
  condiciones_pago?: string
  fecha_solicitud: string
}

export type CorreoNormalizado = {
  id: string
  de: string
  asunto: string
  fecha: string
}

export type CotizacionNormalizada = {
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

export type AprobacionNormalizada = {
  de: string
  fecha: string
  aprobado: boolean
  texto: string
}

export type FacturaNormalizada = {
  numero: string
  fecha: string
  total: number
}

export type Paquete = {
  correo: CorreoNormalizado | null
  solicitud: Solicitud | null
  cotizacion: CotizacionNormalizada | null
  aprobacion: AprobacionNormalizada | null
  factura: FacturaNormalizada | null
  faltantes: string[]
}

export type Hallazgo = {
  codigo: string
  mensaje: string
  accion: string
}

export type Derivados = {
  proveedor: {
    codigo_sap: string
    nit: string
    nombre: string
    fuente: "maestro.proveedores"
  } | null
  indicador_iva: {
    codigo: string
    fuente: "solicitud" | "maestro.proveedores"
    confirmacion_requerida: boolean
  } | null
  condiciones_pago: {
    codigo: string
    fuente: "solicitud" | "maestro.proveedores"
  } | null
  aprobador: { email: string; tope: number } | null
  cotizacion_ref: string | null
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

export type ProveedorMaestro = {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}

export type AprobadorMaestro = {
  email: string
  nombre?: string
  tope: number
}

export type CentroCostoMaestro = {
  centro_costo: string
  nombre: string
  subareas: string[]
  aprobadores: AprobadorMaestro[]
}

export type IndicadorIva = {
  codigo: string
  descripcion: string
  tasa: number
}

export type CondicionPago = {
  codigo: string
  descripcion: string
  dias: number
}
