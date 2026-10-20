// Tipos y utilidades compartidas por las herramientas.
// Regla de oro: ninguna herramienta lanza excepciones; siempre devuelve { ok, data } u { ok: false, error }.
import { z } from "zod"
import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

export type ToolCtx = {
  directory: string // raíz del proyecto
  sessionId: string
  confirmacionHumana?: boolean // lo calcula el servidor, nunca el modelo
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export type Herramienta<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute: (args: z.infer<z.ZodObject<S>>, ctx: ToolCtx) => Promise<string>
}

export const ok = <T>(data: T): string => JSON.stringify({ ok: true, data })
export const fail = (error: string): string => JSON.stringify({ ok: false, error })

/** Envuelve la lógica para garantizar que nunca se propague una excepción hacia el agente. */
export function seguro<A>(fn: (args: A, ctx: ToolCtx) => Promise<string>) {
  return async (args: A, ctx: ToolCtx): Promise<string> => {
    try {
      return await fn(args, ctx)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(`Error interno de la herramienta: ${msg}`)
    }
  }
}

const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{0,80}$/

export const rutas = (ctx: ToolCtx) => {
  const base = join(ctx.directory, "fixtures", "reto-01")
  return {
    casos: join(base, "casos"),
    caso: (caso: string) => join(base, "casos", caso),
    maestro: join(base, "repositorio", "maestro.json"),
    soportesDir: join(base, "repositorio", "soportes"),
    soportesIndex: join(base, "repositorio", "soportes", "index.json"),
    glosario: join(base, "glosario-campos.json"),
    reglas: join(ctx.directory, "src", "knowledge", "reglas.json"),
    out: join(ctx.directory, "out"),
    outCaso: (caso: string) => join(ctx.directory, "out", caso),
  }
}

/** Valida el nombre del caso (evita rutas como ../../etc) y que exista. */
export function validarCaso(caso: string, ctx: ToolCtx): Resultado<string> {
  if (!CASO_VALIDO.test(caso)) return { ok: false, error: `Nombre de caso inválido: "${caso}". Usa solo minúsculas, números y guiones.` }
  const dir = rutas(ctx).caso(caso)
  if (!existsSync(dir)) return { ok: false, error: `El caso "${caso}" no existe en fixtures/reto-01/casos/.` }
  return { ok: true, data: dir }
}

/** Lee y valida un JSON. Distingue archivo ausente, JSON corrupto y estructura inesperada. */
export async function leerJson<T>(ruta: string, esquema: z.ZodType<T>, nombre: string): Promise<Resultado<T>> {
  if (!existsSync(ruta)) return { ok: false, error: `No se encontró ${nombre}.` }
  let crudo: unknown
  try {
    crudo = JSON.parse(await readFile(ruta, "utf8"))
  } catch {
    return { ok: false, error: `${nombre} está corrupto (no es un JSON válido).` }
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) return { ok: false, error: `${nombre} no tiene la estructura esperada: ${r.error.issues[0]?.message ?? "formato inválido"}.` }
  return { ok: true, data: r.data }
}

export async function escribir(ruta: string, contenido: string | Uint8Array): Promise<void> {
  await mkdir(join(ruta, ".."), { recursive: true })
  await writeFile(ruta, contenido)
}

export async function anexarLinea(ruta: string, obj: unknown): Promise<void> {
  await mkdir(join(ruta, ".."), { recursive: true })
  await appendFile(ruta, JSON.stringify(obj) + "\n")
}

/** Fecha de ejecución (YYYY-MM-DD). FECHA_EJECUCION permite fijarla para pruebas reproducibles. */
export function fechaEjecucion(): string {
  const fija = process.env.FECHA_EJECUCION
  if (fija && /^\d{4}-\d{2}-\d{2}$/.test(fija)) return fija
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

/** Ruta relativa a la raíz del proyecto, para mostrar al usuario sin exponer rutas absolutas. */
export const relativa = (ctx: ToolCtx, ruta: string) => ruta.replace(ctx.directory, "").replace(/^[\\/]+/, "")
