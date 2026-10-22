import { mkdir, readFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import type { SapAdapter } from "./adapter.ts"
import type { OrdenCompra } from "../domain/orden.ts"
import { cargarMaestros } from "../domain/maestros.ts"
import { normalizarNit } from "../domain/texto.ts"

const PRIMERA_OC = 4500000001

type Registro = {
  numero_oc: string
  fecha: string
  solicitud_id: string
  orden: OrdenCompra
}

async function leerRegistros(ruta: string): Promise<Registro[]> {
  try {
    const texto = await readFile(ruta, "utf8")
    return texto
      .split("\n")
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0)
      .map((linea) => JSON.parse(linea) as Registro)
  } catch (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (codigo === "ENOENT") return []
    throw error
  }
}

export function crearSapMock(directorio: string): SapAdapter {
  const ruta = join(directorio, "out", "sap", "ordenes.jsonl")

  return {
    async consultarProveedor(nit: string) {
      const maestros = await cargarMaestros(directorio)
      if (!maestros.ok) return null
      const buscado = normalizarNit(nit)
      const proveedor = maestros.data.proveedores.find((item) => normalizarNit(item.nit) === buscado) ?? null
      if (!proveedor) return null
      return { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo }
    },

    async buscarOrdenPorReferencia(solicitudId: string) {
      const registros = await leerRegistros(ruta)
      const encontrado = registros.find((registro) => registro.solicitud_id === solicitudId)
      if (!encontrado) return null
      return { numero_oc: encontrado.numero_oc }
    },

    async crearOrden(orden: OrdenCompra) {
      await mkdir(join(directorio, "out", "sap"), { recursive: true })
      const registros = await leerRegistros(ruta)
      let maximo = PRIMERA_OC - 1
      for (const registro of registros) {
        const numero = Number(registro.numero_oc)
        if (Number.isFinite(numero) && numero > maximo) maximo = numero
      }
      const numeroOc = String(maximo + 1)
      const fecha = new Date().toISOString()
      const registro: Registro = {
        numero_oc: numeroOc,
        fecha,
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      }
      await appendFile(ruta, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: numeroOc, fecha }
    },
  }
}

export async function buscarRegistro(
  directorio: string,
  solicitudId: string,
): Promise<{ numero_oc: string; fecha: string } | null> {
  const ruta = join(directorio, "out", "sap", "ordenes.jsonl")
  const registros = await leerRegistros(ruta)
  const encontrado = registros.find((registro) => registro.solicitud_id === solicitudId)
  if (!encontrado) return null
  return { numero_oc: encontrado.numero_oc, fecha: encontrado.fecha }
}
