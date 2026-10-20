// Interfaz propia del proveedor de LLM. El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor = escribir otra implementación de LLMAdapter, sin tocar el ciclo.
import type { EspecHerramienta } from "../tools/registro.ts"

export type LlamadaHerramienta = { id: string; nombre: string; args: Record<string, unknown> }

export type Mensaje =
  | { rol: "usuario"; texto: string }
  // `crudo` guarda la respuesta original del proveedor (p.ej. las firmas de razonamiento de Gemini),
  // que algunos proveedores exigen reenviar intacta en el siguiente turno.
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[]; crudo?: unknown }
  | { rol: "herramienta"; resultados: { id: string; nombre: string; contenido: string }[] }

export type RespuestaLLM = {
  texto: string
  llamadas: LlamadaHerramienta[]
  crudo?: unknown
  tokens: number
}

export interface LLMAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(sistema: string, mensajes: Mensaje[], herramientas: EspecHerramienta[], senal?: AbortSignal): Promise<RespuestaLLM>
}

export class ErrorLLM extends Error {
  constructor(
    message: string,
    readonly tipo: "timeout" | "autenticacion" | "limite" | "proveedor" | "configuracion",
  ) {
    super(message)
  }
}
