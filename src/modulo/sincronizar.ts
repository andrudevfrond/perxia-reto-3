import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

function hash(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

export function renderAgentMd(prompt: string): string {
  return `---
description: Agente que prepara y crea órdenes de compra en SAP a partir del paquete de solicitud, cotización y aprobación.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt.trimEnd()}
`
}

export function renderSkillMd(conocimiento: string): string {
  return `---
name: ordenes-compra
description: Proceso de preparación de órdenes de compra, controles y excepciones que el agente explica a la analista.
---

${conocimiento.trimEnd()}
`
}

function cuerpo(texto: string): string {
  const normalizado = texto.replace(/^\uFEFF/, "")
  if (!normalizado.startsWith("---\n")) return normalizado.trimEnd()
  const fin = normalizado.indexOf("\n---\n", 3)
  if (fin < 0) return normalizado.trimEnd()
  return normalizado.slice(fin + 5).replace(/^\n/, "").trimEnd()
}

async function exigir(ruta: string, esperado: string): Promise<void> {
  let actual: string | null = null
  try {
    actual = await readFile(ruta, "utf8")
  } catch (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (codigo !== "ENOENT") throw error
  }
  if (actual === null) {
    await mkdir(join(ruta, ".."), { recursive: true })
    await writeFile(ruta, esperado, "utf8")
    return
  }
  if (hash(actual) !== hash(esperado)) {
    throw new Error(`Divergencia en ${ruta}. El módulo no coincide con la fuente canónica y no se sobrescribe.`)
  }
}

export async function assertModuloSincronizado(directorio: string): Promise<void> {
  const prompt = await readFile(join(directorio, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(directorio, "src", "knowledge", "ordenes-compra.md"), "utf8")
  const agentMd = renderAgentMd(prompt)
  const skillMd = renderSkillMd(conocimiento)
  const rutaAgent = join(directorio, "modulo", "agent.md")
  const rutaSkill = join(directorio, "modulo", "skill", "ordenes-compra", "SKILL.md")
  const rutaTools = join(directorio, "modulo", "tools", "oc.ts")
  await exigir(rutaAgent, agentMd)
  await exigir(rutaSkill, skillMd)
  const agentLeido = await readFile(rutaAgent, "utf8")
  const skillLeido = await readFile(rutaSkill, "utf8")
  if (cuerpo(agentLeido) !== prompt.trimEnd()) {
    throw new Error("El cuerpo de modulo/agent.md no coincide con agent/prompt.md.")
  }
  if (cuerpo(skillLeido) !== conocimiento.trimEnd()) {
    throw new Error("El cuerpo de SKILL.md no coincide con src/knowledge/ordenes-compra.md.")
  }
  const tools = await readFile(rutaTools, "utf8")
  if (!tools.includes('from "../../src/tools/oc.ts"')) {
    throw new Error("modulo/tools/oc.ts no reexporta src/tools/oc.ts.")
  }
}
