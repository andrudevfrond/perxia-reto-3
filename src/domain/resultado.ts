export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export function ok<T>(data: T): Resultado<T> {
  return { ok: true, data }
}

export function fallo(error: string): Resultado<never> {
  return { ok: false, error }
}

export function aJson(resultado: Resultado<unknown>): string {
  return JSON.stringify(resultado)
}
