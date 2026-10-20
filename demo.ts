// demo.ts — Ejecuta las herramientas SIN modelo de lenguaje sobre todos los casos de fixtures/.
// Uso: bun install && bun run demo.ts
import { readdir, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ejecutarHerramienta } from "./src/tools/registro.ts"
import type { ToolCtx } from "./src/tools/lib/base.ts"

const directory = import.meta.dir
const ctx: ToolCtx = { directory, sessionId: "demo" }

type R = { ok: boolean; data?: Record<string, unknown>; error?: string }
const llamar = async (nombre: string, args: Record<string, unknown>, c: ToolCtx = ctx): Promise<R> =>
  JSON.parse(await ejecutarHerramienta(nombre, args, c)) as R

const lista = (x: unknown) => (Array.isArray(x) && x.length ? x.map((v) => (typeof v === "string" ? v : (v as { etiqueta?: string; tipo?: string }).etiqueta ?? (v as { tipo?: string }).tipo)).join(", ") : "—")

async function procesar(caso: string) {
  console.log(`\n━━━ ${caso} ━━━`)
  const sol = await llamar("proveedor_leer_solicitud", { caso })
  if (!sol.ok) return console.log(`  ✗ leer_solicitud: ${sol.error}`)
  const d = sol.data!
  const campos = (d.campos as { etiqueta: string }[]).map((c) => c.etiqueta)
  console.log(`  Cliente: ${d.cliente} · País: ${d.pais} · Formato: ${d.formato} · Campos: ${campos.length}`)

  const map = await llamar("proveedor_mapear_campos", { caso, campos })
  if (!map.ok) return console.log(`  ✗ mapear_campos: ${map.error}`)
  const m = map.data!
  console.log(`  Llenos: ${(m.llenos as unknown[]).length} · Faltantes: ${lista(m.faltantes)} · Por confirmar: ${lista(m.requiere_confirmacion)}`)

  const form = await llamar("proveedor_generar_formulario", { caso })
  console.log(form.ok ? `  Formulario: ${form.data!.ruta}${form.data!.aviso ? ` (${form.data!.aviso})` : ""}` : `  ✗ generar_formulario: ${form.error}`)

  const paq = await llamar("proveedor_armar_paquete", { caso })
  if (!paq.ok) return console.log(`  ✗ armar_paquete: ${paq.error}`)
  const p = paq.data!
  const ch = p.checklist as Record<string, unknown>
  console.log(`  Paquete: ${p.ruta} · listo_para_firma: ${p.listo_para_firma}`)
  console.log(`  Soportes vencidos: ${lista(ch.vencidos)} · ausentes: ${lista(ch.ausentes)}`)

  const sinConf = await llamar("proveedor_simular_envio", { caso, confirmado: true })
  console.log(`  Envío sin confirmación humana → ${sinConf.ok ? "✗ NO DEBERÍA PASAR" : `bloqueado ("${sinConf.error}")`}`)
}

async function pruebasDeErrores() {
  console.log("\n━━━ Manejo de errores (HU-5) ━━━")
  const r1 = await llamar("proveedor_leer_solicitud", { caso: "no-existe" })
  console.log(`  Caso inexistente → ${r1.error}`)
  const r2 = await llamar("proveedor_leer_solicitud", { caso: "../../etc" })
  console.log(`  Ruta maliciosa → ${r2.error}`)
  const r3 = await llamar("proveedor_mapear_campos", { caso: "co-industrias-delta" })
  console.log(`  Argumentos inválidos → ${r3.error}`)

  // Plantilla corrupta en una raíz temporal (los fixtures originales no se modifican).
  const raiz = join(directory, "out", "_demo-errores")
  const dir = join(raiz, "fixtures", "reto-01", "casos", "caso-corrupto")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "solicitud.json"), JSON.stringify({ id: "caso-corrupto", de: "x@y.com", asunto: "x", fecha: "2026-09-01", pais: "CO", cliente: "X", cuerpo: "x", formato: "xlsx", adjuntos: [] }))
  await writeFile(join(dir, "plantilla-celdas.json"), "{ esto no es json")
  const r4 = await llamar("proveedor_leer_solicitud", { caso: "caso-corrupto" }, { directory: raiz, sessionId: "demo" })
  console.log(`  Plantilla corrupta → ${r4.error}`)

  // Envío con confirmación humana validada por el servidor.
  const r5 = await llamar("proveedor_simular_envio", { caso: "ec-corp-andina", confirmado: true }, { ...ctx, confirmacionHumana: true })
  console.log(`  Envío con confirmación → ${r5.ok ? `${r5.data!.ruta}${r5.data!.advertencia ? ` (${r5.data!.advertencia})` : ""}` : r5.error}`)
}

await rm(join(directory, "out"), { recursive: true, force: true }) // determinismo: out/ se limpia al inicio
console.log(`Demo sin modelo · fecha de ejecución: ${process.env.FECHA_EJECUCION || "hoy (America/Bogota)"}`)
const casos = (await readdir(join(directory, "fixtures", "reto-01", "casos"))).sort()
for (const caso of casos) await procesar(caso)
await pruebasDeErrores()
console.log("\nListo. Revisa la carpeta out/.")
