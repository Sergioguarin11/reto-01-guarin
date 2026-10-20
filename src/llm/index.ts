// Fábrica de adaptadores: el proveedor y los modelos se eligen por variables de entorno.
import type { LLMAdapter } from "./adapter.ts"
import { ErrorLLM } from "./adapter.ts"
import { GeminiAdapter } from "./gemini.ts"

const MODELOS_POR_DEFECTO = "gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.1-flash-lite,gemini-3.5-flash"

export function crearAdaptador(): LLMAdapter {
  const proveedor = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase()
  if (proveedor === "gemini") {
    const clave = process.env.GEMINI_API_KEY
    if (!clave) throw new ErrorLLM("Falta la variable de entorno GEMINI_API_KEY.", "configuracion")
    // LLM_MODEL acepta uno o varios modelos separados por coma, en orden de preferencia.
    const modelos = (process.env.LLM_MODEL || MODELOS_POR_DEFECTO)
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
    return new GeminiAdapter(clave, modelos, process.env.LLM_THINKING ?? "low")
  }
  throw new ErrorLLM(`Proveedor no soportado: ${proveedor}. Implementa LLMAdapter en src/llm/.`, "configuracion")
}
