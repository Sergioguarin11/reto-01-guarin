// Implementación de LLMAdapter para Google Gemini (API REST generateContent, sin SDK).
// La clave se lee de GEMINI_API_KEY y viaja solo en el header x-goog-api-key; nunca se registra.
//
// Resiliencia: recibe una LISTA de modelos. Si uno está saturado (503), agotó su cupo (429)
// o no responde a tiempo, pasa al siguiente y recuerda hasta cuándo evitar el agotado.
import { type LLMAdapter, type Mensaje, type RespuestaLLM, ErrorLLM } from "./adapter.ts"
import type { EspecHerramienta } from "../tools/registro.ts"

type Parte = {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> }
  thoughtSignature?: string
}
type Contenido = { role: "user" | "model"; parts: Parte[] }
/** Lo que se guarda en el historial: el contenido original y qué modelo lo produjo. */
type Crudo = { modelo: string; contenido: Contenido }

// Valor documentado por Google para reenviar llamadas a herramientas generadas por OTRO modelo,
// cuya firma de razonamiento no es válida para el modelo actual.
const FIRMA_EXTERNA = "skip_thought_signature_validator"
const API = "https://generativelanguage.googleapis.com/v1beta/models"

type Fallo = { tipo: "cupo_diario" | "cupo_minuto" | "saturado" | "lento"; esperaMs: number; detalle: string }

export class GeminiAdapter implements LLMAdapter {
  readonly proveedor = "google-gemini"
  private readonly evitarHasta = new Map<string, number>()
  private ultimoUsado: string

  constructor(
    private readonly clave: string,
    private readonly modelos: string[],
    private readonly nivelRazonamiento = "", // "low" reduce la latencia; vacío = valor por defecto del modelo
    private readonly timeoutPorModeloMs = 45_000,
  ) {
    if (!modelos.length) throw new ErrorLLM("No hay modelos configurados (LLM_MODEL).", "configuracion")
    this.ultimoUsado = modelos[0] as string
  }

  /** Modelo que respondió por última vez (lo muestra /api/health). */
  get modelo(): string {
    return this.ultimoUsado
  }

  private aContenidos(mensajes: Mensaje[], modelo: string): Contenido[] {
    return mensajes.map((m): Contenido => {
      if (m.rol === "usuario") return { role: "user", parts: [{ text: m.texto }] }
      if (m.rol === "asistente") {
        const crudo = m.crudo as Partial<Crudo> | undefined
        if (crudo?.contenido) {
          // Mismo modelo: se reenvía intacto (Gemini exige sus thoughtSignature).
          if (crudo.modelo === modelo) return crudo.contenido
          // Otro modelo: se quitan los pensamientos y se marca la firma como externa.
          const parts = crudo.contenido.parts
            .filter((p) => !p.thought)
            .map((p) => (p.functionCall ? { functionCall: p.functionCall, thoughtSignature: FIRMA_EXTERNA } : { text: p.text }))
          return { role: "model", parts }
        }
        const parts: Parte[] = []
        if (m.texto) parts.push({ text: m.texto })
        for (const l of m.llamadas) parts.push({ functionCall: { id: l.id, name: l.nombre, args: l.args }, thoughtSignature: FIRMA_EXTERNA })
        return { role: "model", parts: parts.length ? parts : [{ text: "(sin respuesta)" }] }
      }
      return {
        role: "user",
        parts: m.resultados.map((r) => {
          let response: Record<string, unknown>
          try {
            response = JSON.parse(r.contenido) as Record<string, unknown>
          } catch {
            response = { resultado: r.contenido }
          }
          return { functionResponse: { id: r.id, name: r.nombre, response } }
        }),
      }
    })
  }

  /** Interpreta un 429 de Google: cupo diario o por minuto, y cuánto esperar. */
  private static leerCupo(cuerpo: string): Fallo {
    const segundos = Number(cuerpo.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? "60")
    const diario = /PerDay/i.test(cuerpo)
    return { tipo: diario ? "cupo_diario" : "cupo_minuto", esperaMs: segundos * 1000, detalle: diario ? "cupo diario agotado" : "cupo por minuto agotado" }
  }

  /** Un intento contra un modelo. Devuelve la respuesta o un Fallo que permite pasar al siguiente. */
  private async intentar(modelo: string, sistema: string, mensajes: Mensaje[], herramientas: EspecHerramienta[], senal?: AbortSignal, conRazonamiento = true): Promise<RespuestaLLM | Fallo> {
    const cuerpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: this.aContenidos(mensajes, modelo),
      tools: [{ functionDeclarations: herramientas.map((h) => ({ name: h.name, description: h.description, parameters: h.parameters })) }],
      ...(this.nivelRazonamiento && conRazonamiento ? { generationConfig: { thinkingConfig: { thinkingLevel: this.nivelRazonamiento } } } : {}),
    }
    const senales = [AbortSignal.timeout(this.timeoutPorModeloMs), ...(senal ? [senal] : [])]

    let res: Response
    try {
      res = await fetch(`${API}/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.clave },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.any(senales),
      })
    } catch (e) {
      if (senal?.aborted) throw new ErrorLLM("El modelo tardó demasiado en responder.", "timeout")
      if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return { tipo: "lento", esperaMs: 60_000, detalle: "sin respuesta a tiempo" }
      throw new ErrorLLM("No se pudo conectar con el proveedor del modelo.", "proveedor")
    }

    if (res.ok) {
      const json = (await res.json()) as { candidates?: { content?: Contenido }[]; usageMetadata?: { totalTokenCount?: number } }
      const contenido: Contenido = json.candidates?.[0]?.content ?? { role: "model", parts: [] }
      const partes = contenido.parts ?? []
      const texto = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim()
      const llamadas = partes
        .filter((p) => p.functionCall)
        .map((p, i) => ({ id: p.functionCall?.id ?? `llamada-${Date.now()}-${i}`, nombre: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
      const crudo: Crudo = { modelo, contenido: { role: "model", parts: partes } }
      return { texto, llamadas, crudo, tokens: json.usageMetadata?.totalTokenCount ?? 0 }
    }

    const detalle = await res.text().catch(() => "")
    if (res.status === 429) return GeminiAdapter.leerCupo(detalle)
    if (res.status === 503 || res.status === 500) return { tipo: "saturado", esperaMs: 60_000, detalle: `error ${res.status}` }
    if (res.status === 404) return { tipo: "saturado", esperaMs: 3_600_000, detalle: "modelo no disponible" }
    if (res.status === 400 && conRazonamiento && /thinking/i.test(detalle)) {
      // Algunos modelos no aceptan el nivel de razonamiento: se reintenta sin él.
      return this.intentar(modelo, sistema, mensajes, herramientas, senal, false)
    }
    if (res.status === 401 || res.status === 403) throw new ErrorLLM("La clave del modelo no es válida o no tiene permisos.", "autenticacion")
    const msg = (() => {
      try {
        return (JSON.parse(detalle) as { error?: { message?: string } }).error?.message ?? ""
      } catch {
        return ""
      }
    })()
    throw new ErrorLLM(`El proveedor respondió con error ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}.`, "proveedor")
  }

  async enviar(sistema: string, mensajes: Mensaje[], herramientas: EspecHerramienta[], senal?: AbortSignal): Promise<RespuestaLLM> {
    const ahora = Date.now()
    const disponibles = this.modelos.filter((m) => (this.evitarHasta.get(m) ?? 0) <= ahora)
    // Si todos están marcados, se intenta igual el que se libera primero.
    const orden = disponibles.length ? disponibles : [...this.modelos].sort((a, b) => (this.evitarHasta.get(a) ?? 0) - (this.evitarHasta.get(b) ?? 0)).slice(0, 1)

    const fallos: { modelo: string; fallo: Fallo }[] = []
    for (const modelo of orden) {
      const r = await this.intentar(modelo, sistema, mensajes, herramientas, senal)
      if ("tipo" in r) {
        this.evitarHasta.set(modelo, Date.now() + r.esperaMs)
        fallos.push({ modelo, fallo: r })
        console.warn(`[gemini] ${modelo}: ${r.detalle}; probando el siguiente modelo`)
        continue
      }
      if (modelo !== this.ultimoUsado) console.info(`[gemini] respondiendo con ${modelo}`)
      this.ultimoUsado = modelo
      return r
    }

    const todosDiarios = fallos.length > 0 && fallos.every((f) => f.fallo.tipo === "cupo_diario")
    if (todosDiarios) {
      const horas = Math.ceil(Math.min(...fallos.map((f) => f.fallo.esperaMs)) / 3_600_000)
      throw new ErrorLLM(`Se agotó el cupo diario gratuito de todos los modelos configurados. Se libera en unas ${horas} h.`, "limite")
    }
    throw new ErrorLLM("Todos los modelos configurados están saturados en este momento. Intenta de nuevo en un minuto.", "limite")
  }
}
