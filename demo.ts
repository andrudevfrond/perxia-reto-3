import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { OrdenCompra } from "./src/domain/orden.ts"
import type { Validacion } from "./src/domain/tipos.ts"
import { assertModuloSincronizado } from "./src/modulo/sincronizar.ts"
import type { ContextoHerramienta } from "./src/tools/context.ts"
import { ejecutarHerramienta } from "./src/tools/registry.ts"

const directorio = import.meta.dir
const ctx: ContextoHerramienta = { directory: directorio, sessionId: "demo", source: "demo" }

type Sobre<T> = { ok: true; data: T } | { ok: false; error: string }

function leerSobre<T>(texto: string): Sobre<T> {
  return JSON.parse(texto) as Sobre<T>
}

async function herramienta<T>(nombre: string, args: unknown): Promise<Sobre<T>> {
  return leerSobre<T>(await ejecutarHerramienta(nombre, args, ctx))
}

type OrdenRespuesta = { orden: OrdenCompra; trazabilidad: string }
type Creacion = { numero_oc: string; fecha: string; idempotente: boolean }

const errores: string[] = []

function esperar(condicion: boolean, mensaje: string): void {
  if (!condicion) errores.push(mensaje)
}

function codigos(items: { codigo: string }[]): string {
  return items.length ? items.map((item) => item.codigo).join("|") : "-"
}

type Informe = {
  caso: string
  validacion: Validacion
  creacion: Sobre<Creacion>
  orden: OrdenCompra | null
}

async function procesar(caso: string, confirmado: boolean, construir: boolean): Promise<Informe> {
  const paquete = await herramienta<Record<string, unknown>>("oc_leer_paquete", { caso })
  if (!paquete.ok) throw new Error(`${caso} leer: ${paquete.error}`)
  const validacion = await herramienta<Validacion>("oc_validar", { caso, paquete: paquete.data })
  if (!validacion.ok) throw new Error(`${caso} validar: ${validacion.error}`)
  let orden: OrdenCompra | null = null
  if (construir && validacion.data.apta) {
    const payload = await herramienta<OrdenRespuesta>("oc_construir_payload", {
      caso,
      paquete: paquete.data,
      derivados: validacion.data.derivados,
    })
    if (!payload.ok) throw new Error(`${caso} payload: ${payload.error}`)
    orden = payload.data.orden
    const evidencia = await herramienta<{ ruta: string; sha256: string }>("oc_generar_evidencia", { caso })
    if (!evidencia.ok) throw new Error(`${caso} evidencia: ${evidencia.error}`)
    esperar(evidencia.data.sha256 === orden.aprobador.evidencia_sha256, `${caso} sha256 de evidencia distinto al payload`)
  }
  const creacion = await herramienta<Creacion>("oc_crear", {
    caso,
    payload: orden,
    confirmado,
  })
  const oc = creacion.ok ? creacion.data.numero_oc : "-"
  const resultado = creacion.ok
    ? (creacion.data.idempotente ? "idempotente" : "creada")
    : (validacion.data.apta ? "pendiente" : "bloqueada")
  console.log(
    `${caso}  apta=${validacion.data.apta}  bloqueos=${codigos(validacion.data.bloqueos)}  confirmaciones=${codigos(validacion.data.confirmaciones)}  retroactiva=${validacion.data.retroactiva}  oc=${oc}  resultado=${resultado}`,
  )
  return { caso, validacion: validacion.data, creacion, orden }
}

function esperarCaso(
  informe: Informe,
  esperado: {
    apta: boolean
    bloqueos: string[]
    confirmaciones: string[]
    retroactiva: boolean
    oc: string | null
    idempotente?: boolean
  },
): void {
  const v = informe.validacion
  const iguales = (a: string[], b: string[]) => a.join("|") === b.join("|")
  esperar(v.apta === esperado.apta, `${informe.caso} apta=${v.apta}, se esperaba ${esperado.apta}`)
  esperar(iguales(v.bloqueos.map((item) => item.codigo), esperado.bloqueos), `${informe.caso} bloqueos ${codigos(v.bloqueos)}`)
  esperar(
    iguales(v.confirmaciones.map((item) => item.codigo), esperado.confirmaciones),
    `${informe.caso} confirmaciones ${codigos(v.confirmaciones)}`,
  )
  esperar(v.retroactiva === esperado.retroactiva, `${informe.caso} retroactiva=${v.retroactiva}`)
  if (esperado.oc === null) {
    esperar(!informe.creacion.ok, `${informe.caso} no debía crear orden`)
  } else {
    esperar(informe.creacion.ok, `${informe.caso} debía crear: ${informe.creacion.ok ? "" : informe.creacion.error}`)
    if (informe.creacion.ok) {
      esperar(informe.creacion.data.numero_oc === esperado.oc, `${informe.caso} oc=${informe.creacion.data.numero_oc}, se esperaba ${esperado.oc}`)
      if (esperado.idempotente !== undefined) {
        esperar(informe.creacion.data.idempotente === esperado.idempotente, `${informe.caso} idempotente distinto`)
      }
    }
  }
}

async function main(): Promise<void> {
  await assertModuloSincronizado(directorio)
  await rm(join(directorio, "out"), { recursive: true, force: true })

  const sol001 = await procesar("sol-001", false, true)
  const sol002 = await procesar("sol-002", false, false)
  const sol003 = await procesar("sol-003", false, false)
  const sol004 = await procesar("sol-004", false, true)
  const sol005 = await procesar("sol-005", false, true)
  const sol006 = await procesar("sol-006", false, true)
  const sol001b = await procesar("sol-001", false, false)
  const sol004b = await procesar("sol-004", true, true)
  const sol005b = await procesar("sol-005", true, true)
  const sol006b = await procesar("sol-006", true, true)

  esperarCaso(sol001, { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false, oc: "4500000001", idempotente: false })
  esperarCaso(sol002, { apta: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false, oc: null })
  esperarCaso(sol003, { apta: false, bloqueos: ["RC2"], confirmaciones: [], retroactiva: false, oc: null })
  esperarCaso(sol004, { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false, oc: null })
  esperarCaso(sol005, { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true, oc: null })
  esperarCaso(sol006, { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false, oc: null })
  esperarCaso(sol001b, { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false, oc: "4500000001", idempotente: true })
  esperarCaso(sol004b, { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false, oc: "4500000002", idempotente: false })
  esperarCaso(sol005b, { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true, oc: "4500000003", idempotente: false })
  esperarCaso(sol006b, { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false, oc: "4500000004", idempotente: false })

  const rc5 = sol004.validacion.confirmaciones[0]?.mensaje ?? ""
  esperar(rc5.includes("26500000") && rc5.includes("25000000"), "RC5 no muestra los dos valores")
  esperar(sol006.validacion.derivados.indicador_iva?.codigo === "C1", "sol-006 no derivó IVA C1")
  esperar(sol006.validacion.derivados.condiciones_pago?.codigo === "Z030", "sol-006 no derivó Z030")
  esperar((sol001.orden?.posiciones[0]?.descripcion.length ?? 0) <= 40, "descripción de sol-001 supera 40 caracteres")
  esperar(sol001.orden?.posiciones[0]?.unidad === "UN", "sol-001 unidad distinta de UN")
  esperar(sol004.orden?.posiciones[0]?.unidad === "H", "sol-004 unidad distinta de H")

  const evidencia = await readFile(join(directorio, "out", "sol-001", "aprobacion.txt"), "utf8")
  const separado = evidencia.split("\n\nsha256: ")
  const cuerpo = separado[0] ?? ""
  const hashArchivo = (separado[1] ?? "").trim()
  const hashCalculado = createHash("sha256").update(cuerpo, "utf8").digest("hex")
  esperar(hashArchivo === hashCalculado, "sha256 del archivo de evidencia no cuadra")
  esperar(hashArchivo === sol001.orden?.aprobador.evidencia_sha256, "payload sin el sha256 de la evidencia")
  esperar(evidencia.includes("De: ") && evidencia.includes("Para: ") && evidencia.includes("Asunto: "), "faltan encabezados de la evidencia")
  const pdf = await readFile(join(directorio, "out", "sol-001", "aprobacion.pdf"))
  esperar(pdf.subarray(0, 4).toString() === "%PDF", "el PDF de evidencia no es un PDF")

  const ordenes = (await readFile(join(directorio, "out", "sap", "ordenes.jsonl"), "utf8")).trim().split("\n")
  esperar(ordenes.length === 4, `se esperaban 4 órdenes y hay ${ordenes.length}`)

  const control = (await readFile(join(directorio, "out", "control.csv"), "utf8")).trim().split(/\r?\n/).slice(1)
  const esperadas = [
    "SOL-2026-001,creada,4500000001,false",
    "SOL-2026-002,bloqueada,,false,RC1",
    "SOL-2026-003,bloqueada,,false,RC2",
    "SOL-2026-004,pendiente,,false,,RC5",
    "SOL-2026-005,pendiente,,true,,RC8",
    "SOL-2026-006,pendiente,,false,,RC6",
    "SOL-2026-001,idempotente,4500000001,false",
    "SOL-2026-004,creada,4500000002,false,,RC5",
    "SOL-2026-005,creada,4500000003,true,,RC8",
    "SOL-2026-006,creada,4500000004,false,,RC6",
  ]
  esperar(control.length === esperadas.length, `control.csv tiene ${control.length} filas`)
  esperadas.forEach((fila, indice) => {
    const actual = control[indice] ?? ""
    esperar(actual.startsWith(fila), `fila ${indice + 1} de control: ${actual}`)
  })

  if (errores.length > 0) {
    console.error(errores.join("\n"))
    process.exit(1)
  }
  console.log("OK")
}

await main()
