// Canal Telegram: traduce mensajes de Telegram al servicio del agente (mismo ciclo, mismas herramientas).
// Modos:
//   - webhook: en producción (TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET + PUBLIC_URL). Telegram llama a
//     /api/telegram/webhook y firma cada llamada con el secreto (header X-Telegram-Bot-Api-Secret-Token).
//   - polling: en local (solo TELEGRAM_BOT_TOKEN). El servidor consulta a Telegram; no necesita URL pública.
// Seguridad: TELEGRAM_USUARIOS limita quién puede usar el bot (IDs numéricos separados por coma).
import { join, resolve, sep } from "node:path"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { ROOT, OUT, procesarMensaje, listarCasos } from "../servicio.ts"
import type { LlamadaVisible } from "../agent.ts"

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ""
const SECRETO = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
const URL_PUBLICA = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "")
const USUARIOS = (process.env.TELEGRAM_USUARIOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const MODO: "webhook" | "polling" | "apagado" = !TOKEN ? "apagado" : URL_PUBLICA && SECRETO ? "webhook" : "polling"

type Usuario = { id: number; first_name?: string }
type Mensaje = { message_id: number; chat: { id: number }; from?: Usuario; text?: string }
type Update = { update_id: number; message?: Mensaje; callback_query?: { id: string; from: Usuario; data?: string; message?: Mensaje } }
type Boton = { text: string; callback_data: string }

// Menú fijo (teclado persistente): acciones frecuentes sin escribir ni recordar comandos.
const MENU = { solicitudes: "📥 Solicitudes", nueva: "🔄 Nueva conversación", ayuda: "❓ ¿Qué puedes hacer?" }
const TECLADO_MENU = {
  keyboard: [[{ text: MENU.solicitudes }, { text: MENU.nueva }], [{ text: MENU.ayuda }]],
  resize_keyboard: true,
  is_persistent: true,
}

const PAISES: Record<string, string> = { CO: "Colombia", EC: "Ecuador", PE: "Perú", PA: "Panamá", HN: "Honduras" }
const FORMATOS: Record<string, string> = { xlsx: "Excel", pdf: "PDF", portal: "Portal web" }
const CORTO: Record<string, string> = {
  proveedor_leer_solicitud: "Solicitud",
  proveedor_mapear_campos: "Campos",
  proveedor_generar_formulario: "Formulario",
  proveedor_armar_paquete: "Paquete",
  proveedor_simular_envio: "Envío",
}

// ------------------------------------------------------------------ API de Telegram
async function api<T = unknown>(metodo: string, cuerpo: Record<string, unknown> | FormData): Promise<T | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
      method: "POST",
      ...(cuerpo instanceof FormData ? { body: cuerpo } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }),
    })
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number }
    if (!json.ok) {
      console.warn(`[telegram] ${metodo}: ${json.error_code} ${json.description ?? ""}`)
      if (json.error_code === 409) throw new Error("conflicto")
      return null
    }
    return json.result ?? null
  } catch (e) {
    if (e instanceof Error && e.message === "conflicto") throw e
    console.warn(`[telegram] ${metodo}: sin conexión`) // nunca se registra el token
    return null
  }
}

const enviarTexto = (chat: number, html: string, botones?: Boton[][] | typeof TECLADO_MENU) =>
  api("sendMessage", {
    chat_id: chat,
    text: html.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(botones ? { reply_markup: Array.isArray(botones) ? { inline_keyboard: botones } : botones } : {}),
  })

async function enviarArchivo(chat: number, rutaRelativa: string, leyenda: string) {
  const ruta = resolve(ROOT, rutaRelativa)
  if (!ruta.startsWith(OUT + sep) || !existsSync(ruta)) return
  const form = new FormData()
  form.append("chat_id", String(chat))
  form.append("caption", leyenda)
  form.append("document", Bun.file(ruta), ruta.split(sep).pop() ?? "archivo")
  await api("sendDocument", form)
}

// ------------------------------------------------------------------ Formato
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Convierte el Markdown simple del agente al HTML que acepta Telegram. */
function aHtml(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !/^\s*-{3,}\s*$/.test(l))
    .map((l) => {
      const lista = l.match(/^(\s*)[-*•]\s+(.*)/)
      const linea = lista ? `${"   ".repeat(Math.floor((lista[1] ?? "").length / 2))}• ${lista[2]}` : l.replace(/^#+\s*/, "")
      return esc(linea)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/❓?\s*Confirmación requerida:\s*/, "❓ <b>Confirmación requerida:</b> ")
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const lineaPasos = (llamadas: LlamadaVisible[]) =>
  llamadas.length ? `<i>${llamadas.map((t) => `${t.ok ? "✓" : "✗"} ${CORTO[t.nombre] ?? t.nombre}`).join(" · ")}</i>\n\n` : ""

const rutaDe = (t: LlamadaVisible): string | null => {
  const d = (t.resultado as { data?: { ruta?: unknown } } | null)?.data
  return typeof d?.ruta === "string" ? d.ruta : null
}

// ------------------------------------------------------------------ Conversación
const generacion = new Map<number, number>() // /nuevo inicia otra sesión para el mismo chat
const sesionDe = (chat: number) => `tg-${Math.abs(chat)}-${generacion.get(chat) ?? 0}`
const permitido = (u?: Usuario) => USUARIOS.length === 0 || (u ? USUARIOS.includes(String(u.id)) : false)

async function atender(chat: number, texto: string) {
  const escribiendo = setInterval(() => void api("sendChatAction", { chat_id: chat, action: "typing" }), 4500)
  void api("sendChatAction", { chat_id: chat, action: "typing" })
  try {
    const r = await procesarMensaje(sesionDe(chat), texto)
    if ("rechazo" in r) {
      await enviarTexto(chat, esc(r.rechazo))
      return
    }
    const caso = [...r.toolCalls].reverse().map((t) => t.args.caso).find((c): c is string => typeof c === "string")
    const botones: Boton[][] = []
    if (r.needsConfirmation) botones.push([{ text: "✅ Sí, confirmo", callback_data: "conf:si" }, { text: "Todavía no", callback_data: "conf:no" }])
    if (caso && /^[a-z0-9-]+$/.test(caso)) botones.push([{ text: "📋 Pendientes", callback_data: `pend:${caso}` }, { text: "📎 Archivos", callback_data: `arch:${caso}` }])
    await enviarTexto(chat, lineaPasos(r.toolCalls) + aHtml(r.reply), botones.length ? botones : undefined)

    // Archivos generados en este turno: formulario, checklist y constancia de envío.
    for (const t of r.toolCalls.filter((x) => x.ok)) {
      const ruta = rutaDe(t)
      if (!ruta) continue
      if (t.nombre === "proveedor_generar_formulario") await enviarArchivo(chat, ruta, ruta.endsWith(".md") ? "Valores para copiar en el portal" : "Formulario generado")
      if (t.nombre === "proveedor_armar_paquete") await enviarArchivo(chat, join(ruta, "checklist.md"), "Checklist del paquete para firma")
      if (t.nombre === "proveedor_simular_envio") await enviarArchivo(chat, ruta, "Constancia del envío simulado")
    }
  } finally {
    clearInterval(escribiendo)
  }
}

// ------------------------------------------------------------------ Acciones locales (sin consultar al modelo)
const leerJson = async <T>(ruta: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(ruta, "utf8")) as T
  } catch {
    return null
  }
}

/** Pendientes del caso a partir de los resultados ya generados por las herramientas. */
async function pendientes(chat: number, caso: string) {
  const mapeo = await leerJson<{ campos: { etiqueta: string; estado: string; nota?: string }[] }>(join(OUT, caso, "mapeo.json"))
  const paquete = await leerJson<{ listo_para_firma: boolean; bloqueos: string[] }>(join(OUT, caso, "paquete", "estado.json"))
  if (!mapeo && !paquete) return void enviarTexto(chat, `Aún no he procesado <b>${esc(caso)}</b>. Elige la solicitud en ${MENU.solicitudes}.`)
  const faltan = (mapeo?.campos ?? []).filter((c) => c.estado === "faltante")
  const confirmar = (mapeo?.campos ?? []).filter((c) => c.estado === "requiere_confirmacion")
  const lineas = [
    `<b>Pendientes de ${esc(caso)}</b>`,
    paquete ? (paquete.listo_para_firma ? "✅ Listo para firma" : "⛔ No listo para firma") : "",
    ...(paquete?.bloqueos ?? []).map((b) => `🔴 ${esc(b)}`),
    ...confirmar.map((c) => `🟡 Confirmar ${esc(c.etiqueta)}: ${esc(c.nota ?? "")}`),
    ...faltan.map((c) => `⚪ ${esc(c.etiqueta)}: diligenciar a mano`),
  ].filter(Boolean)
  await enviarTexto(chat, lineas.length > 2 ? lineas.join("\n") : `${lineas.join("\n")}\nNada pendiente.`)
}

/** Reenvía el formulario, el checklist y la constancia de envío si existen. */
async function archivos(chat: number, caso: string) {
  const candidatos: [string, string][] = [
    ["formulario.xlsx", "Formulario"], ["formulario.pdf", "Formulario"], ["valores-portal.md", "Valores para el portal"],
    ["paquete/checklist.md", "Checklist"], ["paquete/borrador-correo.md", "Borrador de correo"], ["ENVIO-SIMULADO.md", "Constancia de envío simulado"],
  ]
  const existentes = candidatos.filter(([f]) => existsSync(join(OUT, caso, f)))
  if (!existentes.length) return void enviarTexto(chat, `Aún no hay archivos de <b>${esc(caso)}</b>.`)
  for (const [f, leyenda] of existentes) await enviarArchivo(chat, join("out", caso, f), leyenda)
}

const AYUDA = [
  "<b>Qué hago</b>",
  "Preparo el registro de Periferia como proveedor ante un cliente: leo la solicitud, lleno el formulario con los datos del repositorio, armo el paquete para firma y te digo qué falta.",
  "",
  "<b>Cómo pedírmelo</b>",
  `• Toca ${MENU.solicitudes} y elige una, o escríbeme libremente, por ejemplo: <i>procesa la solicitud de Honduras</i> o <i>¿qué soportes le faltan a Corporación Andina?</i>`,
  "• Después de cada resultado: 📋 Pendientes y 📎 Archivos.",
  "",
  "<b>Lo que nunca hago</b>",
  "No invento datos y no envío nada sin tu confirmación. Firmar y enviar al cliente es decisión de una persona.",
].join("\n")

async function bienvenida(chat: number, nombre?: string) {
  const casos = await listarCasos()
  const botones = casos.map((c) => [{ text: `${c.cliente ?? c.id} · ${PAISES[c.pais ?? ""] ?? c.pais ?? ""} · ${FORMATOS[c.formato ?? ""] ?? c.formato ?? ""}`, callback_data: `caso:${c.id}` }])
  if (nombre !== undefined) await enviarTexto(chat, `Hola ${esc(nombre)}. Preparo el formulario de registro como proveedor y el paquete para firma. <i>Nada se envía sin tu confirmación.</i>`, TECLADO_MENU)
  await enviarTexto(chat, "¿Qué solicitud preparamos? También puedes escribirme lo que necesites.", botones)
}

const instruccionCaso = (id: string) =>
  `Procesa el caso "${id}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`

const vistos = new Set<number>()

async function manejarUpdate(u: Update) {
  if (vistos.has(u.update_id)) return // Telegram puede reenviar el mismo update
  vistos.add(u.update_id)
  if (vistos.size > 500) vistos.delete(vistos.values().next().value as number)

  const cb = u.callback_query
  if (cb?.message) {
    const chat = cb.message.chat.id
    await api("answerCallbackQuery", { callback_query_id: cb.id })
    await api("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } })
    if (!permitido(cb.from)) return void enviarTexto(chat, `No tienes acceso a este agente. Tu ID de Telegram es <code>${cb.from.id}</code>.`)
    const data = cb.data ?? ""
    if (data.startsWith("caso:")) return atender(chat, instruccionCaso(data.slice(5)))
    if (data === "conf:si") return atender(chat, "Sí, confirmo")
    if (data === "conf:no") return atender(chat, "No, todavía no")
    const caso = data.slice(5)
    if (!/^[a-z0-9-]+$/.test(caso)) return
    if (data.startsWith("pend:")) return pendientes(chat, caso)
    if (data.startsWith("arch:")) return archivos(chat, caso)
    return
  }

  const m = u.message
  if (!m?.text) return
  const chat = m.chat.id
  if (!permitido(m.from)) return void enviarTexto(chat, `No tienes acceso a este agente. Tu ID de Telegram es <code>${m.from?.id ?? "?"}</code>; compártelo con el administrador.`)
  const texto = m.text.trim()
  const comando = texto.split(/\s|@/)[0]?.toLowerCase()
  if (comando === "/start") return bienvenida(chat, m.from?.first_name ?? "")
  if (comando === "/casos" || texto === MENU.solicitudes) return bienvenida(chat)
  if (comando === "/ayuda" || texto === MENU.ayuda) return void enviarTexto(chat, AYUDA, TECLADO_MENU)
  if (comando === "/nuevo" || texto === MENU.nueva) {
    generacion.set(chat, (generacion.get(chat) ?? 0) + 1)
    await enviarTexto(chat, "Listo, empezamos una conversación nueva.", TECLADO_MENU)
    return bienvenida(chat)
  }
  return atender(chat, m.text)
}

const procesarSeguro = (u: Update) => manejarUpdate(u).catch((e) => console.error("[telegram] error:", e instanceof Error ? e.message : e))

// ------------------------------------------------------------------ Arranque
async function sondear() {
  let offset = 0
  console.log("[telegram] modo polling (local)")
  for (;;) {
    try {
      const updates = await api<Update[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] })
      for (const u of updates ?? []) {
        offset = u.update_id + 1
        void procesarSeguro(u)
      }
      if (!updates) await Bun.sleep(5000)
    } catch {
      console.warn("[telegram] el bot tiene un webhook activo (Azure): el polling local se detiene para no interferir.")
      return
    }
  }
}

export const telegram = {
  estado: () => ({ modo: MODO, acceso_restringido: USUARIOS.length > 0 }),

  async iniciar() {
    if (MODO === "apagado") return
    await api("setMyCommands", {
      commands: [
        { command: "casos", description: "Ver las solicitudes pendientes" },
        { command: "nuevo", description: "Empezar otra conversación" },
        { command: "ayuda", description: "Qué puede hacer el agente" },
      ],
    }).catch(() => null)
    if (!USUARIOS.length) console.warn("[telegram] TELEGRAM_USUARIOS vacío: cualquiera puede usar el bot (con los topes diarios del agente).")
    if (MODO === "webhook") {
      const ok = await api("setWebhook", { url: `${URL_PUBLICA}/api/telegram/webhook`, secret_token: SECRETO, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }).catch(() => null)
      console.log(`[telegram] modo webhook ${ok ? "registrado" : "NO registrado"}`)
      return
    }
    void sondear()
  },

  async webhook(req: Request): Promise<Response> {
    if (MODO !== "webhook") return new Response("Telegram no está configurado en modo webhook", { status: 404 })
    if (req.headers.get("x-telegram-bot-api-secret-token") !== SECRETO) return new Response("No autorizado", { status: 401 })
    let u: Update
    try {
      u = (await req.json()) as Update
    } catch {
      return new Response("JSON inválido", { status: 400 })
    }
    void procesarSeguro(u) // se responde de inmediato; el turno del agente puede tardar
    return new Response("ok")
  },
}
