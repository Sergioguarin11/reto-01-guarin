// Genera modulo/ a partir de las MISMAS fuentes que usa la aplicación (sin copias divergentes):
//   agent/prompt.md                       → modulo/agent.md
//   src/knowledge/registro-proveedor.md   → modulo/skill/registro-proveedor/SKILL.md
//   src/tools/proveedor.ts                → modulo/tools/proveedor.ts (re-export)
// Uso: bun run modulo        ·  bun run modulo --check (falla si modulo/ está desactualizado)
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const prompt = await readFile(join(ROOT, "agent", "prompt.md"), "utf8")
const conocimiento = await readFile(join(ROOT, "src", "knowledge", "registro-proveedor.md"), "utf8")

const archivos: Record<string, string> = {
  "modulo/agent.md": `---
description: Prepara formularios de registro como proveedor y el paquete para firma, sin inventar datos y con confirmación humana antes de cualquier envío.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}`,
  "modulo/skill/registro-proveedor/SKILL.md": `---
name: registro-proveedor
description: Conocimiento del proceso de registro de Periferia como proveedor ante clientes de CO, EC, PE, PA y HN (identificadores tributarios, soportes, vigencias y cierre humano).
---

${conocimiento}`,
  "modulo/tools/proveedor.ts": `// Generado por scripts/generar-modulo.ts — no editar.
// Re-exporta las mismas herramientas de la aplicación; se pueden importar sin el servidor.
export * from "../../src/tools/proveedor.ts"
export type { ToolCtx } from "../../src/tools/lib/base.ts"
`,
}

const check = process.argv.includes("--check")
let desactualizado = false
for (const [ruta, contenido] of Object.entries(archivos)) {
  const destino = join(ROOT, ruta)
  if (check) {
    const actual = existsSync(destino) ? await readFile(destino, "utf8") : ""
    if (actual !== contenido) {
      console.error(`Desactualizado: ${ruta}`)
      desactualizado = true
    }
  } else {
    await mkdir(join(destino, ".."), { recursive: true })
    await writeFile(destino, contenido)
    console.log(`Generado: ${ruta}`)
  }
}
if (check) {
  if (desactualizado) process.exit(1)
  console.log("modulo/ está sincronizado con la aplicación.")
}
