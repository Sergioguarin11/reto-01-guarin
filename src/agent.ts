// Ciclo del agente: prompt → modelo → herramientas → modelo … → respuesta.
// Independiente del HTTP y del proveedor: recibe un LLMAdapter y una sesión.
import { type LLMAdapter, type Mensaje, ErrorLLM } from "./llm/adapter.ts"
import { ejecutarHerramienta, especificaciones } from "./tools/registro.ts"
import { normalizar } from "./tools/lib/mapeo.ts"

export type LlamadaVisible = { nombre: string; args: Record<string, unknown>; ok: boolean; resumen: string; resultado: unknown }

export type EventoVisible = {
  rol: "usuario" | "asistente"
  texto: string
  ts: string
  toolCalls?: LlamadaVisible[]
  needsConfirmation?: boolean
  error?: boolean
}

export type Sesion = {
  id: string
  creada: string
  mensajes: Mensaje[] // historial que ve el modelo
  historial: EventoVisible[] // historial que ve la persona
  tokens: number
  pendienteConfirmacion: boolean
}

export type Limites = { maxIteraciones: number; maxTokensSesion: number; timeoutMs: number }

export type ResultadoTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; error?: boolean }

export const MARCA_CONFIRMACION = "Confirmación requerida"

export const nuevaSesion = (id: string): Sesion => ({ id, creada: new Date().toISOString(), mensajes: [], historial: [], tokens: 0, pendienteConfirmacion: false })

/** CA3: solo cuenta como confirmación una respuesta afirmativa explícita, sin negaciones. */
export function esAfirmativo(texto: string): boolean {
  const t = normalizar(texto)
  if (/\b(no|cancela|cancelar|espera|todavia|aun|despues|luego)\b/.test(t)) return false
  return /^(si|confirmo|confirmado|adelante|dale|procede|ok|de acuerdo|envia|envialo|enviar|hazlo|correcto|claro)\b/.test(t)
}

/** Resumen de una respuesta de herramienta para mostrar en el chat (sin volcar todo el JSON). */
function paraMostrar(contenido: string): { ok: boolean; resumen: string; resultado: unknown } {
  try {
    const r = JSON.parse(contenido) as { ok: boolean; data?: Record<string, unknown>; error?: string }
    if (!r.ok) return { ok: false, resumen: r.error ?? "error", resultado: r }
    const d = r.data ?? {}
    const partes = Object.entries(d).flatMap(([k, v]) => {
      if (Array.isArray(v)) return [`${k}: ${v.length}`]
      if (typeof v === "boolean" || (typeof v === "string" && v.length < 60)) return [`${k}: ${v}`]
      return []
    })
    return { ok: true, resumen: partes.slice(0, 6).join(" · "), resultado: r }
  } catch {
    return { ok: false, resumen: "respuesta no válida", resultado: contenido }
  }
}

export async function ejecutarTurno(
  sesion: Sesion,
  mensajeUsuario: string,
  deps: { llm: LLMAdapter; sistema: string; directory: string; limites: Limites },
): Promise<ResultadoTurno> {
  // La confirmación se calcula aquí (servidor), no la decide el modelo.
  const confirmacionHumana = sesion.pendienteConfirmacion && esAfirmativo(mensajeUsuario)
  sesion.pendienteConfirmacion = false

  sesion.mensajes.push({ rol: "usuario", texto: mensajeUsuario })
  sesion.historial.push({ rol: "usuario", texto: mensajeUsuario, ts: new Date().toISOString() })

  const herramientas = especificaciones()
  const ctx = { directory: deps.directory, sessionId: sesion.id, confirmacionHumana }
  const llamadasTurno: LlamadaVisible[] = []
  let reply = ""
  let error = false

  for (let i = 0; ; i++) {
    if (i >= deps.limites.maxIteraciones) {
      // CA1: al llegar al tope se responde con lo que hay y lo que falta.
      const hechas = llamadasTurno.map((l) => `- ${l.nombre}: ${l.ok ? "ok" : "error"} (${l.resumen})`).join("\n")
      reply = `Alcancé el tope de ${deps.limites.maxIteraciones} pasos en este turno.\n\nLo que hice:\n${hechas || "- nada"}\n\nPídeme que continúe para completar lo que falta.`
      sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] })
      break
    }
    if (sesion.tokens >= deps.limites.maxTokensSesion) {
      reply = "Esta sesión alcanzó su tope de consumo de tokens. Abre una sesión nueva para continuar."
      sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] })
      error = true
      break
    }

    let r
    try {
      r = await deps.llm.enviar(deps.sistema, sesion.mensajes, herramientas, AbortSignal.timeout(deps.limites.timeoutMs))
    } catch (e) {
      // CA5: el error se muestra claro y la sesión sigue viva.
      reply = e instanceof ErrorLLM ? `⚠️ ${e.message}` : "⚠️ Ocurrió un error inesperado al consultar el modelo."
      if (!(e instanceof ErrorLLM)) console.error("[agente] error no tipado:", e instanceof Error ? e.message : e)
      sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] })
      error = true
      break
    }

    sesion.tokens += r.tokens
    sesion.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas, crudo: r.crudo })

    if (r.llamadas.length === 0) {
      reply = r.texto || "No obtuve respuesta del modelo. Intenta reformular la solicitud."
      break
    }

    const resultados = []
    for (const l of r.llamadas) {
      const contenido = await ejecutarHerramienta(l.nombre, l.args, ctx)
      resultados.push({ id: l.id, nombre: l.nombre, contenido })
      llamadasTurno.push({ nombre: l.nombre, args: l.args, ...paraMostrar(contenido) })
    }
    sesion.mensajes.push({ rol: "herramienta", resultados })
  }

  const needsConfirmation = !error && reply.includes(MARCA_CONFIRMACION)
  sesion.pendienteConfirmacion = needsConfirmation
  sesion.historial.push({ rol: "asistente", texto: reply, ts: new Date().toISOString(), toolCalls: llamadasTurno, needsConfirmation, error })
  return { reply, toolCalls: llamadasTurno, needsConfirmation, error }
}
