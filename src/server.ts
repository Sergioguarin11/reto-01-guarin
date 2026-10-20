// Servidor HTTP (Bun): API del chat + front estático + descarga de archivos generados.
// La clave del modelo solo existe en variables de entorno de este proceso.
import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve, relative, sep } from "node:path"
import { crearAdaptador } from "./llm/index.ts"
import type { LLMAdapter } from "./llm/adapter.ts"
import { type Sesion, ejecutarTurno, nuevaSesion } from "./agent.ts"

const ROOT = resolve(import.meta.dir, "..")
const OUT = join(ROOT, "out")
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

const CONFIG = {
  puerto: num(process.env.PORT, 3000),
  claveAcceso: process.env.ACCESS_KEY ?? "",
  limites: {
    maxIteraciones: num(process.env.MAX_ITERACIONES, 25),
    maxTokensSesion: num(process.env.MAX_TOKENS_SESION, 300_000),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 60_000),
  },
  maxTurnosDia: num(process.env.MAX_TURNOS_DIA, 300),
  maxLargoMensaje: 4000,
}

let llm: LLMAdapter | null = null
let errorLlm = ""
try {
  llm = crearAdaptador()
} catch (e) {
  errorLlm = e instanceof Error ? e.message : String(e)
  console.warn(`[servidor] Modelo no configurado: ${errorLlm}`)
}

// Comportamiento (prompt) + conocimiento: se leen en cada turno para que un cambio no requiera reiniciar.
async function sistema(): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(join(ROOT, "agent", "prompt.md"), "utf8"),
    readFile(join(ROOT, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  ])
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
  return `${prompt}\n\n---\n\n${conocimiento}\n\n---\nFecha de hoy: ${fecha}.`
}

// --- Sesiones: memoria + respaldo en out/sesiones/ -------------------------------------------
const sesiones = new Map<string, Sesion>()
const ocupadas = new Set<string>()
const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/

async function obtenerSesion(id: string): Promise<Sesion> {
  const enMemoria = sesiones.get(id)
  if (enMemoria) return enMemoria
  const ruta = join(OUT, "sesiones", `${id}.json`)
  const s = existsSync(ruta) ? (JSON.parse(await readFile(ruta, "utf8")) as Sesion) : nuevaSesion(id)
  sesiones.set(id, s)
  return s
}
async function guardarSesion(s: Sesion) {
  await mkdir(join(OUT, "sesiones"), { recursive: true })
  await writeFile(join(OUT, "sesiones", `${s.id}.json`), JSON.stringify(s))
}

// --- Tope global diario para que nadie gaste la clave sin límite -----------------------------
let turnosHoy = { dia: "", n: 0 }
function consumirTurno(): boolean {
  const hoy = new Date().toISOString().slice(0, 10)
  if (turnosHoy.dia !== hoy) turnosHoy = { dia: hoy, n: 0 }
  if (turnosHoy.n >= CONFIG.maxTurnosDia) return false
  turnosHoy.n++
  return true
}

// --- Utilidades HTTP -------------------------------------------------------------------------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } })

const autorizado = (req: Request) => !CONFIG.claveAcceso || req.headers.get("x-access-key") === CONFIG.claveAcceso

async function listarArchivos(dir: string, base = dir): Promise<string[]> {
  if (!existsSync(dir)) return []
  const salida: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) salida.push(...(await listarArchivos(ruta, base)))
    else if (!["mapeo.json", "estado.json"].includes(e.name)) salida.push(relative(base, ruta).split(sep).join("/"))
  }
  return salida.sort()
}

const TIPOS: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
}

async function servirArchivoOut(ruta: string): Promise<Response> {
  const destino = resolve(OUT, ruta)
  if (!destino.startsWith(OUT + sep) || destino.includes(`${sep}sesiones${sep}`)) return json({ error: "Ruta no permitida" }, 403)
  if (!existsSync(destino) || !(await stat(destino)).isFile()) return json({ error: "Archivo no encontrado" }, 404)
  const ext = destino.slice(destino.lastIndexOf("."))
  return new Response(Bun.file(destino), { headers: { "Content-Type": TIPOS[ext] ?? "application/octet-stream" } })
}

// --- Rutas -----------------------------------------------------------------------------------
async function manejar(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const p = url.pathname

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return new Response(Bun.file(join(ROOT, "web", "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  if (req.method === "GET" && p === "/api/health") {
    return json({ ok: true, provider: llm?.proveedor ?? null, model: llm?.modelo ?? null, llm_configurado: !!llm, requiere_clave_acceso: !!CONFIG.claveAcceso })
  }
  if (!autorizado(req)) return json({ error: "Clave de acceso requerida" }, 401)

  if (req.method === "GET" && p === "/api/casos") {
    const dir = join(ROOT, "fixtures", "reto-01", "casos")
    const ids = (await readdir(dir)).sort()
    const casos = await Promise.all(
      ids.map(async (id) => {
        try {
          const s = JSON.parse(await readFile(join(dir, id, "solicitud.json"), "utf8")) as Record<string, unknown>
          return { id, cliente: s.cliente, pais: s.pais, formato: s.formato, fecha: s.fecha, asunto: s.asunto }
        } catch {
          return { id }
        }
      }),
    )
    return json({ casos })
  }

  if (req.method === "POST" && p === "/api/chat") {
    let body: { sessionId?: unknown; message?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ error: "El cuerpo debe ser JSON: { sessionId, message }" }, 400)
    }
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!ID_VALIDO.test(sessionId)) return json({ error: "sessionId inválido" }, 400)
    if (!message || message.length > CONFIG.maxLargoMensaje) return json({ error: `El mensaje debe tener entre 1 y ${CONFIG.maxLargoMensaje} caracteres` }, 400)
    if (!llm) return json({ reply: `⚠️ El modelo no está configurado en el servidor: ${errorLlm}`, toolCalls: [], needsConfirmation: false, error: true })
    if (ocupadas.has(sessionId)) return json({ error: "Esta sesión todavía está procesando el mensaje anterior" }, 409)
    if (!consumirTurno()) return json({ reply: "⚠️ Se alcanzó el tope diario de uso del agente. Intenta mañana.", toolCalls: [], needsConfirmation: false, error: true })

    ocupadas.add(sessionId)
    try {
      const sesion = await obtenerSesion(sessionId)
      const r = await ejecutarTurno(sesion, message, { llm, sistema: await sistema(), directory: ROOT, limites: CONFIG.limites })
      await guardarSesion(sesion)
      return json({ sessionId, ...r, tokensSesion: sesion.tokens })
    } finally {
      ocupadas.delete(sessionId)
    }
  }

  const mSesion = p.match(/^\/api\/sessions\/([A-Za-z0-9-]{8,64})$/)
  if (req.method === "GET" && mSesion) {
    const s = await obtenerSesion(mSesion[1] as string)
    return json({ id: s.id, creada: s.creada, tokens: s.tokens, pendienteConfirmacion: s.pendienteConfirmacion, historial: s.historial })
  }

  const mArchivos = p.match(/^\/api\/archivos\/([a-z0-9-]+)$/)
  if (req.method === "GET" && mArchivos) {
    return json({ caso: mArchivos[1], archivos: await listarArchivos(join(OUT, mArchivos[1] as string)) })
  }

  if (req.method === "GET" && p.startsWith("/out/")) return servirArchivoOut(decodeURIComponent(p.slice(5)))

  return json({ error: "No encontrado" }, 404)
}

Bun.serve({
  port: CONFIG.puerto,
  idleTimeout: 255, // los turnos con varias herramientas pueden tardar
  async fetch(req) {
    try {
      return await manejar(req)
    } catch (e) {
      console.error("[servidor]", e instanceof Error ? e.message : e)
      return json({ error: "Error interno del servidor" }, 500)
    }
  },
})

console.log(`Agente Registro Proveedor en http://localhost:${CONFIG.puerto} · modelo: ${llm ? `${llm.proveedor}/${llm.modelo}` : "NO CONFIGURADO"}`)
