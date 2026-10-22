import { useEffect, useMemo, useState } from "react"

type Llamada = {
  name: string
  arguments: unknown
  result: string
  ok: boolean
}

type Turno =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: Llamada[]; needsConfirmation: boolean }

type Salud = { ok: boolean; provider: string; model: string }

const ATAJOS = [
  { caso: "sol-001", detalle: "Caso limpio", texto: 'Procesa la solicitud "sol-001". Si está apta y no pide confirmación, crea la orden y dime el número.' },
  { caso: "sol-002", detalle: "Proveedor inexistente", texto: 'Procesa la solicitud "sol-002". Si hay bloqueos, no crees la orden: dime la razón y qué debo pedir.' },
  { caso: "sol-003", detalle: "Aprobador sin autoridad", texto: 'Procesa la solicitud "sol-003". Si hay bloqueos, no crees la orden: dime la razón y qué debo pedir.' },
  { caso: "sol-004", detalle: "Cotización distinta", texto: 'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.' },
  { caso: "sol-005", detalle: "Factura anterior", texto: 'Procesa la solicitud "sol-005". Dime si es retroactiva y no la crees hasta que yo lo confirme.' },
  { caso: "sol-006", detalle: "IVA no informado", texto: 'Procesa la solicitud "sol-006". Dime qué datos derivaste y no la crees hasta que yo lo confirme.' },
]

function sesionInicial(): string {
  const guardada = sessionStorage.getItem("oc-session")
  if (guardada) return guardada
  const nueva = crypto.randomUUID()
  sessionStorage.setItem("oc-session", nueva)
  return nueva
}

function resumir(resultado: string): string {
  try {
    const json = JSON.parse(resultado) as { ok?: boolean; error?: string; data?: unknown }
    if (json.ok === false) return json.error ?? "Error"
    return JSON.stringify(json.data, null, 2)
  } catch {
    return resultado
  }
}

export function App() {
  const [sessionId] = useState(sesionInicial)
  const [turns, setTurns] = useState<Turno[]>([])
  const [texto, setTexto] = useState("")
  const [pensando, setPensando] = useState(false)
  const [salud, setSalud] = useState<Salud | null>(null)
  const [errorSalud, setErrorSalud] = useState("")

  const esperaConfirmacion = useMemo(
    () => [...turns].reverse().find((turno) => turno.role === "assistant" && turno.needsConfirmation) !== undefined
      && turns.at(-1)?.role === "assistant"
      && turns.at(-1)?.role === "assistant"
      && (turns.at(-1) as Extract<Turno, { role: "assistant" }>).needsConfirmation,
    [turns],
  )

  useEffect(() => {
    void fetch("/api/health")
      .then(async (respuesta) => {
        if (!respuesta.ok) throw new Error("La API no responde.")
        const cuerpo = await respuesta.json() as Salud
        const serializado = JSON.stringify(cuerpo)
        if (/sk-|api[_-]?key|bearer/i.test(serializado)) {
          setErrorSalud("La salud de la API expone un secreto.")
        }
        setSalud(cuerpo)
      })
      .catch((error: unknown) => {
        setErrorSalud(error instanceof Error ? error.message : "No hay conexión con la API.")
      })
  }, [])

  async function enviar(mensaje: string) {
    const limpio = mensaje.trim()
    if (!limpio || pensando) return
    setTexto("")
    setPensando(true)
    setTurns((prev) => [...prev, { role: "user", content: limpio }])
    try {
      const respuesta = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: limpio }),
      })
      const cuerpo = await respuesta.json() as {
        reply?: string
        toolCalls?: Llamada[]
        needsConfirmation?: boolean
        error?: string
      }
      setTurns((prev) => [...prev, {
        role: "assistant",
        content: cuerpo.reply || cuerpo.error || "El servidor no envió una respuesta.",
        toolCalls: cuerpo.toolCalls ?? [],
        needsConfirmation: cuerpo.needsConfirmation === true,
      }])
    } catch (error) {
      const mensajeError = error instanceof Error ? error.message : "No se pudo hablar con el servidor."
      setTurns((prev) => [...prev, {
        role: "assistant",
        content: mensajeError,
        toolCalls: [],
        needsConfirmation: false,
      }])
    } finally {
      setPensando(false)
    }
  }

  return (
    <div className="app">
      <aside className="rail">
        <h1 className="brand">Mesa de compras <span>órdenes SAP</span></h1>
        <p className="lede">La analista pide un caso. El agente lee, valida y solo crea la orden si el control lo permite.</p>
        <div className="casos">
          {ATAJOS.map((atajo) => (
            <button key={atajo.caso} type="button" disabled={pensando} onClick={() => void enviar(atajo.texto)}>
              <strong>Procesar {atajo.caso}</strong>
              <small>{atajo.detalle}</small>
            </button>
          ))}
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <h2>Conversación</h2>
            <p className="status">{salud ? `${salud.provider} · ${salud.model}` : "Conectando con la API"}</p>
            {errorSalud ? <p className="status">{errorSalud}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              const nueva = crypto.randomUUID()
              sessionStorage.setItem("oc-session", nueva)
              window.location.reload()
            }}
          >
            Nueva sesión
          </button>
        </header>
        <section className="historial" aria-live="polite">
          {turns.length === 0 ? <p className="hint">Elige un caso o escribe, por ejemplo: procesa la solicitud sol-001.</p> : null}
          {turns.map((turno, indice) => (
            turno.role === "user" ? (
              <article className="burbuja user" key={indice}>{turno.content}</article>
            ) : (
              <article className="burbuja" key={indice}>
                {turno.needsConfirmation ? <div className="aviso" role="status">Confirmación requerida antes de crear la orden.</div> : null}
                {turno.toolCalls.length > 0 ? (
                  <div className="tools">
                    {turno.toolCalls.map((llamada, llamadaIndice) => (
                      <details key={llamadaIndice} className={llamada.ok ? "tool ok" : "tool bad"} open>
                        <summary>
                          <span>{llamada.name}</span>
                          <span>{llamada.ok ? "ok" : "error"}</span>
                        </summary>
                        <pre>{JSON.stringify(llamada.arguments, null, 2)}</pre>
                        <pre>{resumir(llamada.result)}</pre>
                      </details>
                    ))}
                  </div>
                ) : null}
                <div>{turno.content}</div>
              </article>
            )
          ))}
          {pensando ? <p className="pensando">Pensando…</p> : null}
        </section>
        {esperaConfirmacion ? (
          <div className="confirmar">
            <button className="si" type="button" disabled={pensando} onClick={() => void enviar("Confirmo")}>Confirmo</button>
            <button type="button" disabled={pensando} onClick={() => void enviar("No crees la orden")}>No crear</button>
          </div>
        ) : null}
        <form
          className="composer"
          onSubmit={(evento) => {
            evento.preventDefault()
            void enviar(texto)
          }}
        >
          <textarea
            aria-label="Mensaje"
            value={texto}
            placeholder="Escribe a la analista virtual"
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <button className="enviar" type="submit" disabled={pensando || texto.trim() === ""}>Enviar</button>
        </form>
      </main>
    </div>
  )
}
