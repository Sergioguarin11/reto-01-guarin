// Registro de herramientas: descubre los exports de cada módulo, valida argumentos con zod,
// ejecuta y deja traza (CA4 y RN5). Lo usan tanto el servidor como demo.ts.
import { z } from "zod"
import { join } from "node:path"
import { existsSync } from "node:fs"
import * as proveedor from "./proveedor.ts"
import { type ToolCtx, anexarLinea, fail } from "./lib/base.ts"

type HerramientaGenerica = {
  description: string
  args: z.ZodRawShape
  execute: (args: never, ctx: ToolCtx) => Promise<string>
}

const MODULOS: Record<string, Record<string, unknown>> = { proveedor }

const esHerramienta = (x: unknown): x is HerramientaGenerica =>
  typeof x === "object" && x !== null && "execute" in x && "args" in x && "description" in x

/** Nombre visible para el modelo: <archivo>_<export>. */
export const HERRAMIENTAS: Record<string, HerramientaGenerica> = Object.fromEntries(
  Object.entries(MODULOS).flatMap(([archivo, mod]) =>
    Object.entries(mod)
      .filter(([, v]) => esHerramienta(v))
      .map(([nombre, v]) => [`${archivo}_${nombre}`, v as HerramientaGenerica]),
  ),
)

export type EspecHerramienta = { name: string; description: string; parameters: Record<string, unknown> }

/** Convierte los esquemas zod a JSON Schema simple, aceptado por los proveedores de LLM. */
export function especificaciones(): EspecHerramienta[] {
  return Object.entries(HERRAMIENTAS).map(([name, h]) => {
    const schema = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
    delete schema.$schema
    delete schema.additionalProperties
    return { name, description: h.description, parameters: schema }
  })
}

/** Resumen corto y sin datos sensibles para los logs: solo conteos, rutas, formatos y banderas. */
function resumir(resultado: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(resultado) as { ok: boolean; data?: Record<string, unknown>; error?: string }
    if (!r.ok) return { ok: false, resumen: r.error ?? "error" }
    const partes = Object.entries(r.data ?? {}).flatMap(([k, v]) => {
      if (Array.isArray(v)) return [`${k}=${v.length}`]
      if (typeof v === "boolean") return [`${k}=${v}`]
      if (["ruta", "formato", "pais", "caso"].includes(k) && typeof v === "string") return [`${k}=${v}`]
      return []
    })
    return { ok: true, resumen: partes.join(" ") }
  } catch {
    return { ok: false, resumen: "respuesta no JSON" }
  }
}

/** Valida y ejecuta una herramienta. Nunca lanza: los errores vuelven al modelo como { ok:false }. */
export async function ejecutarHerramienta(nombre: string, argsCrudos: unknown, ctx: ToolCtx): Promise<string> {
  const h = HERRAMIENTAS[nombre]
  let resultado: string
  if (!h) {
    resultado = fail(`Herramienta desconocida: ${nombre}`)
  } else {
    const parsed = z.object(h.args).safeParse(argsCrudos ?? {})
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      resultado = fail(`Argumentos inválidos: ${issue?.path.join(".") || "args"} — ${issue?.message ?? "no cumple el esquema"}`)
    } else {
      try {
        resultado = await h.execute(parsed.data as never, ctx)
      } catch (e) {
        resultado = fail(`Error inesperado: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const { ok, resumen } = resumir(resultado)
  const caso = typeof (argsCrudos as { caso?: unknown })?.caso === "string" ? (argsCrudos as { caso: string }).caso : null
  const linea = { ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: nombre, ok, resumen }
  try {
    await anexarLinea(join(ctx.directory, "out", "log.jsonl"), linea)
    const casoReal = caso && /^[a-z0-9-]+$/.test(caso) && existsSync(join(ctx.directory, "fixtures", "reto-01", "casos", caso))
    if (casoReal) await anexarLinea(join(ctx.directory, "out", caso, "log.jsonl"), linea)
  } catch {
    /* el log nunca debe tumbar la herramienta */
  }
  return resultado
}
