// Backlog del producto como código: una sola fuente (backlog/backlog.json) para
//   bun run backlog md       → genera BACKLOG.md (visible para cualquiera en el repositorio)
//   bun run backlog cargar   → crea Épicas, Features y PBIs en Azure DevOps (proceso Scrum) con la CLI `az`
// La carga es idempotente: guarda los IDs creados en backlog/ids-azure-devops.json y no duplica.
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

type Pbi = { titulo: string; historia: string; criterios: string[]; esfuerzo: number; prioridad: number; valor: number; estado: string; tags: string[] }
type Feature = { clave: string; titulo: string; estado: string; pbis: Pbi[] }
type Epica = { clave: string; titulo: string; descripcion: string; estado: string; features: Feature[] }
type Backlog = { producto: string; proceso: string; repositorio: string; epicas: Epica[] }

const ROOT = join(import.meta.dir, "..")
const backlog = JSON.parse(await readFile(join(ROOT, "backlog", "backlog.json"), "utf8")) as Backlog
const modo = process.argv[2] ?? "md"

// ------------------------------------------------------------------ BACKLOG.md
function generarMarkdown(b: Backlog): string {
  const pbis = b.epicas.flatMap((e) => e.features.flatMap((f) => f.pbis))
  const hechos = pbis.filter((p) => p.estado === "Done")
  const puntos = (xs: Pbi[]) => xs.reduce((s, p) => s + p.esfuerzo, 0)
  const lineas = [
    `# Backlog del producto — ${b.producto}`,
    "",
    `Proceso **${b.proceso}** (Épica → Feature → Product Backlog Item). Fuente única: \`backlog/backlog.json\`, cargada también en Azure DevOps con \`bun run backlog cargar\`.`,
    "",
    `**Avance:** ${hechos.length} de ${pbis.length} PBIs terminados · ${puntos(hechos)} de ${puntos(pbis)} puntos de esfuerzo.`,
    "",
    "| Épica | Estado | PBIs | Puntos |",
    "|---|---|---|---|",
    ...b.epicas.map((e) => {
      const ps = e.features.flatMap((f) => f.pbis)
      return `| ${e.clave} · ${e.titulo} | ${e.estado} | ${ps.length} | ${puntos(ps)} |`
    }),
    "",
  ]
  for (const e of b.epicas) {
    lineas.push(`## ${e.clave} · ${e.titulo}`, "", `_${e.estado}._ ${e.descripcion}`, "")
    for (const f of e.features) {
      lineas.push(`### ${f.clave} · ${f.titulo}`, "")
      for (const p of f.pbis) {
        lineas.push(
          `#### ${p.estado === "Done" ? "✅" : p.estado === "Committed" ? "🔄" : "⬜"} ${p.titulo}`,
          "",
          `${p.historia}`,
          "",
          `**Estado:** ${p.estado} · **Esfuerzo:** ${p.esfuerzo} · **Prioridad:** ${p.prioridad} · **Valor de negocio:** ${p.valor} · ${p.tags.map((t) => `\`${t}\``).join(" ")}`,
          "",
          "Criterios de aceptación:",
          ...p.criterios.map((c) => `- ${c}`),
          "",
        )
      }
    }
  }
  return lineas.join("\n")
}

// ------------------------------------------------------------------ Azure DevOps
const RUTA_IDS = join(ROOT, "backlog", "ids-azure-devops.json")

function az(args: string[]): Record<string, unknown> {
  const r = Bun.spawnSync(["az", ...args, "-o", "json"], { stdout: "pipe", stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`az ${args.slice(0, 3).join(" ")} falló: ${r.stderr.toString().trim().split("\n").pop()}`)
  return JSON.parse(r.stdout.toString()) as Record<string, unknown>
}

const html = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function crear(tipo: string, titulo: string, descripcion: string, campos: string[], estado: string, padre: number | null): number {
  const creado = az(["boards", "work-item", "create", "--type", tipo, "--title", titulo, "--description", descripcion, ...(campos.length ? ["--fields", ...campos] : [])])
  const id = Number(creado.id)
  if (estado !== "New") az(["boards", "work-item", "update", "--id", String(id), "--state", estado])
  if (padre) az(["boards", "work-item", "relation", "add", "--id", String(id), "--relation-type", "parent", "--target-id", String(padre)])
  console.log(`  #${id} ${tipo}: ${titulo} [${estado}]`)
  return id
}

async function cargar(b: Backlog) {
  const ids: Record<string, number> = existsSync(RUTA_IDS) ? (JSON.parse(await readFile(RUTA_IDS, "utf8")) as Record<string, number>) : {}
  const guardar = () => writeFile(RUTA_IDS, JSON.stringify(ids, null, 2))
  const obtener = async (clave: string, fn: () => number) => {
    if (ids[clave]) return ids[clave] as number
    ids[clave] = fn()
    await guardar()
    return ids[clave] as number
  }

  for (const e of b.epicas) {
    const idE = await obtener(e.clave, () => crear("Epic", e.titulo, `<p>${html(e.descripcion)}</p><p>Repositorio: <a href="${b.repositorio}">${b.repositorio}</a></p>`, [], e.estado, null))
    for (const f of e.features) {
      const idF = await obtener(f.clave, () => crear("Feature", f.titulo, `<p>${html(f.titulo)}</p>`, [], f.estado, idE))
      for (const [i, p] of f.pbis.entries()) {
        await obtener(`${f.clave}.${i + 1}`, () =>
          crear(
            "Product Backlog Item",
            p.titulo,
            `<p>${html(p.historia)}</p>`,
            [
              `Microsoft.VSTS.Common.AcceptanceCriteria=<ul>${p.criterios.map((c) => `<li>${html(c)}</li>`).join("")}</ul>`,
              `Microsoft.VSTS.Scheduling.Effort=${p.esfuerzo}`,
              `Microsoft.VSTS.Common.Priority=${p.prioridad}`,
              `Microsoft.VSTS.Common.BusinessValue=${p.valor}`,
              `System.Tags=${p.tags.join("; ")}`,
            ],
            p.estado,
            idF,
          ),
        )
      }
    }
  }
  console.log(`\nListo: ${Object.keys(ids).length} elementos en Azure DevOps (IDs en backlog/ids-azure-devops.json).`)
}

if (modo === "md") {
  await writeFile(join(ROOT, "BACKLOG.md"), generarMarkdown(backlog))
  console.log("Generado: BACKLOG.md")
} else if (modo === "cargar") {
  await cargar(backlog)
} else {
  console.error('Uso: bun run backlog [md|cargar]')
  process.exit(1)
}
