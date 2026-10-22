export function normalizarNombre(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

/** Los maestros guardan el NIT sin dígito de verificación (9 dígitos). */
export function normalizarNit(valor: string): string {
  const digitos = soloDigitos(valor)
  if (digitos.length > 9) return digitos.slice(0, 9)
  return digitos
}

export function diaIso(fecha: string): string {
  const coincidencia = fecha.match(/^(\d{4}-\d{2}-\d{2})/)
  return coincidencia?.[1] ?? fecha
}

export function sumarDias(iso: string, dias: number): string | null {
  const partes = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!partes) return null
  const anio = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])
  if (!anio || !mes || !dia) return null
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

/** Montos de los fixtures usan punto como separador de miles: 11.400.000 */
export function parsearMonto(crudo: string): number | null {
  const limpio = crudo.trim()
  if (!/^\d{1,3}(\.\d{3})+$/.test(limpio) && !/^\d+$/.test(limpio)) return null
  const valor = Number(limpio.replace(/\./g, ""))
  if (!Number.isFinite(valor)) return null
  return valor
}

export function esCaso(caso: string): boolean {
  return /^sol-\d{3}$/.test(caso)
}
