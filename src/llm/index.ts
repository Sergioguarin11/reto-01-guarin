// Fábrica de adaptadores: el proveedor se elige por variable de entorno.
import type { LLMAdapter } from "./adapter.ts"
import { ErrorLLM } from "./adapter.ts"
import { GeminiAdapter } from "./gemini.ts"

export function crearAdaptador(): LLMAdapter {
  const proveedor = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase()
  if (proveedor === "gemini") {
    const clave = process.env.GEMINI_API_KEY
    if (!clave) throw new ErrorLLM("Falta la variable de entorno GEMINI_API_KEY.", "configuracion")
    return new GeminiAdapter(clave, process.env.LLM_MODEL || "gemini-3.5-flash", process.env.LLM_THINKING ?? "low")
  }
  throw new ErrorLLM(`Proveedor no soportado: ${proveedor}. Implementa LLMAdapter en src/llm/.`, "configuracion")
}
