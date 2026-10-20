// Contenido del paquete para firma: estado de soportes, checklist y borrador de correo.
import type { CampoMapeado, IndiceSoportes, Solicitud } from "./esquemas.ts"

export type EstadoSoporte = {
  tipo: string
  nombre: string
  estado: "presente" | "ausente" | "vencido"
  archivo: string | null
  vigencia_hasta: string | null
  nota?: string
}

/** RN3: un soporte vencido o ausente bloquea listo_para_firma. */
export function evaluarSoportes(
  exigidos: string[],
  indice: IndiceSoportes,
  fecha: string,
  paisCliente: string,
  nombres: Record<string, string>,
): EstadoSoporte[] {
  return exigidos.map((tipo) => {
    const nombre = nombres[tipo] ?? tipo
    const s = indice.find((x) => x.tipo === tipo)
    if (!s) return { tipo, nombre, estado: "ausente", archivo: null, vigencia_hasta: null, nota: "No existe en el repositorio de soportes." }
    const nota = s.pais_emisor !== paisCliente ? `Emitido en ${s.pais_emisor}; el cliente es de ${paisCliente}. Validar si lo acepta.` : undefined
    if (s.vigencia_hasta && s.vigencia_hasta < fecha) {
      return { tipo, nombre, estado: "vencido", archivo: s.archivo, vigencia_hasta: s.vigencia_hasta, nota: `Venció el ${s.vigencia_hasta}. Solicitar una versión actualizada.` }
    }
    return { tipo, nombre, estado: "presente", archivo: s.archivo, vigencia_hasta: s.vigencia_hasta, nota }
  })
}

export function bloqueos(soportes: EstadoSoporte[], formularioPresente: boolean): string[] {
  const b = soportes.filter((s) => s.estado !== "presente").map((s) => `Soporte ${s.estado}: ${s.nombre}`)
  if (!formularioPresente) b.unshift("Formulario no generado")
  return b
}

const marca = { presente: "[x]", ausente: "[ ] AUSENTE", vencido: "[ ] VENCIDO" }

export function checklistMd(sol: Solicitud, fecha: string, soportes: EstadoSoporte[], campos: CampoMapeado[], formulario: string | null, listo: boolean, bloq: string[]): string {
  const faltantes = campos.filter((c) => c.estado === "faltante")
  const porConfirmar = campos.filter((c) => c.estado === "requiere_confirmacion")
  return [
    `# Checklist de registro — ${sol.cliente}`,
    "",
    `- Caso: \`${sol.id}\` · País: ${sol.pais} · Formato: ${sol.formato}`,
    `- Fecha de revisión: ${fecha}`,
    `- **Estado: ${listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    ...(bloq.length ? ["", "## Bloqueos", ...bloq.map((b) => `- ${b}`)] : []),
    "",
    "## Formulario",
    formulario ? `- [x] ${formulario}` : "- [ ] Formulario no generado",
    "",
    "## Soportes exigidos",
    ...soportes.map((s) => `- ${marca[s.estado]} ${s.nombre}${s.vigencia_hasta ? ` (vigencia: ${s.vigencia_hasta})` : ""}${s.nota ? ` — ${s.nota}` : ""}`),
    "",
    "## Campos faltantes (no bloquean; diligenciar a mano)",
    ...(faltantes.length ? faltantes.map((c) => `- [ ] ${c.etiqueta}`) : ["- Ninguno"]),
    "",
    "## Campos que requieren confirmación humana",
    ...(porConfirmar.length ? porConfirmar.map((c) => `- [ ] ${c.etiqueta}: ${c.nota ?? ""}`) : ["- Ninguno"]),
    "",
    "## Cierre (humano)",
    "- [ ] Revisión de la analista",
    "- [ ] Firma del representante legal",
    "- [ ] Envío al cliente",
    "",
  ].join("\n")
}

/** RN2: el borrador NUNCA incluye datos bancarios. Solo nombra los documentos adjuntos. */
export function borradorCorreoMd(sol: Solicitud, adjuntos: string[], listo: boolean): string {
  return [
    `**Para:** ${sol.de}`,
    `**Asunto:** RE: ${sol.asunto}`,
    "",
    "---",
    "",
    "Buen día,",
    "",
    `En atención a su solicitud, Periferia IT Group S.A.S. remite la documentación para su registro como proveedor de ${sol.cliente}:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier información adicional.",
    "",
    "Cordialmente,",
    "",
    "Área Administrativa — Periferia IT Group",
    "",
    "---",
    `> BORRADOR generado por el agente. ${listo ? "" : "**El paquete NO está listo para firma: revisar el checklist antes de enviar.** "}Requiere revisión, firma del representante legal y envío por parte de una persona.`,
    "",
  ].join("\n")
}
