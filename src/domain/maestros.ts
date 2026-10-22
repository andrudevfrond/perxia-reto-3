import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fallo, ok, type Resultado } from "./resultado.ts"
import type { CentroCostoMaestro, CondicionPago, IndicadorIva, ProveedorMaestro } from "./tipos.ts"
import { normalizarNit, normalizarNombre } from "./texto.ts"

export type Maestros = {
  proveedores: ProveedorMaestro[]
  centros: CentroCostoMaestro[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

async function leerJson<T>(ruta: string): Promise<Resultado<T>> {
  try {
    const texto = await readFile(ruta, "utf8")
    return ok(JSON.parse(texto) as T)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "no se pudo leer el archivo"
    return fallo(`Maestro ilegible (${ruta}): ${mensaje}`)
  }
}

export async function cargarMaestros(directorio: string): Promise<Resultado<Maestros>> {
  const base = join(directorio, "fixtures", "reto-03", "maestros")
  const proveedores = await leerJson<ProveedorMaestro[]>(join(base, "proveedores.json"))
  if (!proveedores.ok) return proveedores
  const centros = await leerJson<CentroCostoMaestro[]>(join(base, "centros-costo.json"))
  if (!centros.ok) return centros
  const indicadoresIva = await leerJson<IndicadorIva[]>(join(base, "indicadores-iva.json"))
  if (!indicadoresIva.ok) return indicadoresIva
  const condicionesPago = await leerJson<CondicionPago[]>(join(base, "condiciones-pago.json"))
  if (!condicionesPago.ok) return condicionesPago
  return ok({
    proveedores: proveedores.data,
    centros: centros.data,
    indicadoresIva: indicadoresIva.data,
    condicionesPago: condicionesPago.data,
  })
}

export function buscarProveedor(
  maestros: Maestros,
  nit: string | undefined,
  nombre: string,
): ProveedorMaestro | null {
  if (nit && nit.trim()) {
    const buscado = normalizarNit(nit)
    return maestros.proveedores.find((proveedor) => normalizarNit(proveedor.nit) === buscado) ?? null
  }
  const buscado = normalizarNombre(nombre)
  return maestros.proveedores.find((proveedor) => normalizarNombre(proveedor.nombre) === buscado) ?? null
}

export function buscarCentro(maestros: Maestros, codigo: string): CentroCostoMaestro | null {
  return maestros.centros.find((centro) => centro.centro_costo === codigo) ?? null
}
