import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { fallo, ok, type Resultado } from "./resultado.ts"
import { rutaCaso } from "./paquete.ts"
import { esCaso } from "./texto.ts"

export type AprobacionCruda = {
  de: string
  para: string
  fecha: string
  asunto: string
  cuerpo: string
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

export function textoEvidencia(aprobacion: AprobacionCruda): string {
  return [
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    "",
    aprobacion.cuerpo.trimEnd(),
  ].join("\n")
}

export async function leerAprobacionCruda(directorio: string, caso: string): Promise<Resultado<AprobacionCruda>> {
  if (!esCaso(caso)) return fallo("El caso debe tener la forma sol-001.")
  try {
    const texto = await readFile(join(rutaCaso(directorio, caso), "aprobacion.json"), "utf8")
    const crudo = JSON.parse(texto) as Record<string, unknown>
    if (typeof crudo.de !== "string" || typeof crudo.fecha !== "string" || typeof crudo.cuerpo !== "string") {
      return fallo("La aprobación no trae de, fecha o cuerpo.")
    }
    const para = typeof crudo.para === "string" ? crudo.para : ""
    const asunto = typeof crudo.asunto === "string" ? crudo.asunto : ""
    return ok({ de: crudo.de, para, fecha: crudo.fecha, asunto, cuerpo: crudo.cuerpo })
  } catch (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (codigo === "ENOENT") {
      return fallo("No hay correo de aprobación para generar la evidencia. Pide el correo del líder.")
    }
    return fallo("aprobacion.json está malformado. Pide al solicitante el correo del líder de nuevo.")
  }
}

export async function hashEvidencia(directorio: string, caso: string): Promise<Resultado<string>> {
  const aprobacion = await leerAprobacionCruda(directorio, caso)
  if (!aprobacion.ok) return aprobacion
  return ok(sha256(textoEvidencia(aprobacion.data)))
}

function contenidoConHash(cuerpo: string, hash: string): string {
  return `${cuerpo}\n\nsha256: ${hash}\n`
}

function envolver(texto: string, ancho: number): string[] {
  const lineas: string[] = []
  for (const parrafo of texto.split("\n")) {
    if (parrafo.length === 0) {
      lineas.push("")
      continue
    }
    let resto = parrafo
    while (resto.length > ancho) {
      let corte = resto.lastIndexOf(" ", ancho)
      if (corte < 8) corte = ancho
      lineas.push(resto.slice(0, corte))
      resto = resto.slice(corte).trimStart()
    }
    lineas.push(resto)
  }
  return lineas
}

function seguroParaPdf(linea: string): string {
  return [...linea].map((caracter) => {
    const codigo = caracter.codePointAt(0) ?? 0
    if (codigo >= 32 && codigo <= 126) return caracter
    if (codigo >= 160 && codigo <= 255) return caracter
    return "?"
  }).join("")
}

async function escribirPdf(ruta: string, texto: string): Promise<void> {
  const pdf = await PDFDocument.create()
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  const lineas = envolver(texto, 85)
  let pagina = pdf.addPage([595, 842])
  let y = 800
  for (const linea of lineas) {
    if (y < 48) {
      pagina = pdf.addPage([595, 842])
      y = 800
    }
    if (linea.length > 0) {
      pagina.drawText(seguroParaPdf(linea), { x: 48, y, size: 11, font: fuente })
    }
    y -= 16
  }
  await writeFile(ruta, await pdf.save())
}

export async function generarEvidencia(
  directorio: string,
  caso: string,
): Promise<Resultado<{ ruta: string; rutaPdf: string; sha256: string }>> {
  const aprobacion = await leerAprobacionCruda(directorio, caso)
  if (!aprobacion.ok) return aprobacion
  const cuerpo = textoEvidencia(aprobacion.data)
  const hash = sha256(cuerpo)
  const carpeta = join(directorio, "out", caso)
  await mkdir(carpeta, { recursive: true })
  const ruta = join(carpeta, "aprobacion.txt")
  const rutaPdf = join(carpeta, "aprobacion.pdf")
  await writeFile(ruta, contenidoConHash(cuerpo, hash), "utf8")
  await escribirPdf(rutaPdf, contenidoConHash(cuerpo, hash).trimEnd())
  return ok({ ruta, rutaPdf, sha256: hash })
}
