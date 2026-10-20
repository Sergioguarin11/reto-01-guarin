// Implementación de LLMAdapter para Google Gemini (API REST generateContent, sin SDK).
// La clave se lee de GEMINI_API_KEY y viaja solo en el header x-goog-api-key; nunca se registra.
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

export class GeminiAdapter implements LLMAdapter {
  readonly proveedor = "google-gemini"
  constructor(
    private readonly clave: string,
    readonly modelo: string,
    private readonly nivelRazonamiento = "", // "low" reduce la latencia; vacío = valor por defecto del modelo
  ) {}

  private aContenidos(mensajes: Mensaje[]): Contenido[] {
    return mensajes.map((m): Contenido => {
      if (m.rol === "usuario") return { role: "user", parts: [{ text: m.texto }] }
      if (m.rol === "asistente") {
        // Se reenvía el contenido original para conservar las thoughtSignature que Gemini exige.
        if (m.crudo) return m.crudo as Contenido
        const parts: Parte[] = []
        if (m.texto) parts.push({ text: m.texto })
        for (const l of m.llamadas) parts.push({ functionCall: { id: l.id, name: l.nombre, args: l.args } })
        return { role: "model", parts }
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

  async enviar(sistema: string, mensajes: Mensaje[], herramientas: EspecHerramienta[], senal?: AbortSignal): Promise<RespuestaLLM> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelo)}:generateContent`
    const cuerpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: this.aContenidos(mensajes),
      tools: [{ functionDeclarations: herramientas.map((h) => ({ name: h.name, description: h.description, parameters: h.parameters })) }],
      ...(this.nivelRazonamiento ? { generationConfig: { thinkingConfig: { thinkingLevel: this.nivelRazonamiento } } } : {}),
    }

    // Reintentos con espera creciente ante saturación temporal del proveedor (429/500/503).
    const esperas = [1000, 3000, 6000]
    let res: Response
    for (let intento = 0; ; intento++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.clave },
          body: JSON.stringify(cuerpo),
          signal: senal,
        })
      } catch (e) {
        if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) throw new ErrorLLM("El modelo tardó demasiado en responder.", "timeout")
        throw new ErrorLLM("No se pudo conectar con el proveedor del modelo.", "proveedor")
      }
      const transitorio = res.status === 429 || res.status === 500 || res.status === 503
      if (!transitorio || intento >= esperas.length) break
      await res.body?.cancel()
      console.warn(`[gemini] respuesta ${res.status}; reintento ${intento + 1} de ${esperas.length}`)
      await new Promise((ok) => setTimeout(ok, esperas[intento]))
      if (senal?.aborted) throw new ErrorLLM("El modelo tardó demasiado en responder.", "timeout")
    }

    if (!res.ok) {
      const detalle = await res.text().catch(() => "")
      if (res.status === 401 || res.status === 403) throw new ErrorLLM("La clave del modelo no es válida o no tiene permisos.", "autenticacion")
      if (res.status === 429) throw new ErrorLLM("Se alcanzó el límite de uso del modelo. Intenta en un minuto.", "limite")
      if (res.status === 503) throw new ErrorLLM("El modelo está saturado en este momento (alta demanda en Google). Reintenté 3 veces; intenta de nuevo en un minuto.", "limite")
      const msg = (() => {
        try {
          return (JSON.parse(detalle) as { error?: { message?: string } }).error?.message ?? ""
        } catch {
          return ""
        }
      })()
      throw new ErrorLLM(`El proveedor respondió con error ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}.`, "proveedor")
    }

    const json = (await res.json()) as {
      candidates?: { content?: Contenido; finishReason?: string }[]
      usageMetadata?: { totalTokenCount?: number }
    }
    const contenido = json.candidates?.[0]?.content ?? { role: "model" as const, parts: [] }
    const partes = contenido.parts ?? []
    const texto = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim()
    const llamadas = partes
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: p.functionCall?.id ?? `llamada-${Date.now()}-${i}`, nombre: p.functionCall!.name, args: p.functionCall!.args ?? {} }))

    return { texto, llamadas, crudo: { role: "model", parts: partes }, tokens: json.usageMetadata?.totalTokenCount ?? 0 }
  }
}
