// Servidor HTTP (Bun): API del chat + front estático + descarga de archivos generados + webhook de Telegram.
// La clave del modelo solo existe en variables de entorno de este proceso.
import { readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve, relative, sep } from "node:path"
import { ROOT, OUT, ID_VALIDO, llm, procesarMensaje, obtenerSesion, listarCasos } from "./servicio.ts"
import { telegram } from "./canales/telegram.ts"

const PUERTO = Number(process.env.PORT) || 3000
const CLAVE_ACCESO = process.env.ACCESS_KEY ?? ""

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } })

const autorizado = (req: Request) => !CLAVE_ACCESO || req.headers.get("x-access-key") === CLAVE_ACCESO

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

async function manejar(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const p = url.pathname

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return new Response(Bun.file(join(ROOT, "web", "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
  if (req.method === "GET" && p === "/api/health") {
    return json({ ok: true, provider: llm?.proveedor ?? null, model: llm?.modelo ?? null, llm_configurado: !!llm, requiere_clave_acceso: !!CLAVE_ACCESO, telegram: telegram.estado() })
  }
  // Telegram firma cada llamada con su propio secreto; no usa la clave de acceso del chat web.
  if (req.method === "POST" && p === "/api/telegram/webhook") return telegram.webhook(req)

  if (!autorizado(req)) return json({ error: "Clave de acceso requerida" }, 401)

  if (req.method === "GET" && p === "/api/casos") return json({ casos: await listarCasos() })

  if (req.method === "POST" && p === "/api/chat") {
    let body: { sessionId?: unknown; message?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ error: "El cuerpo debe ser JSON: { sessionId, message }" }, 400)
    }
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
    const message = typeof body.message === "string" ? body.message : ""
    const r = await procesarMensaje(sessionId, message)
    if ("rechazo" in r) return json({ error: r.rechazo }, r.estado)
    return json({ sessionId, ...r })
  }

  const mSesion = p.match(/^\/api\/sessions\/([A-Za-z0-9-]{8,64})$/)
  if (req.method === "GET" && mSesion && ID_VALIDO.test(mSesion[1] as string)) {
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
  port: PUERTO,
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

console.log(`Agente Registro Proveedor en http://localhost:${PUERTO} · modelo: ${llm ? `${llm.proveedor}/${llm.modelo}` : "NO CONFIGURADO"}`)
await telegram.iniciar()
