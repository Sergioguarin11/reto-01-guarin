// Generadores de documentos: Excel (exceljs), PDF (pdf-lib) y Markdown.
// Ambas librerías son 100% JavaScript: no requieren LibreOffice ni binarios del sistema.
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import type { CampoMapeado, PlantillaCeldas } from "./esquemas.ts"

export type Fila = { etiqueta: string; obligatorio: boolean; campo: CampoMapeado | null }

const FECHA_FIJA = new Date("2026-01-01T00:00:00Z") // metadatos fijos → archivos reproducibles

/** Escribe cada etiqueta y su valor exactamente en la hoja y celda indicadas por la plantilla. */
export async function generarXlsx(plantilla: PlantillaCeldas, mapeo: Map<string, CampoMapeado>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Agente Registro Proveedor"
  wb.created = FECHA_FIJA
  wb.modified = FECHA_FIJA

  for (const item of plantilla) {
    const hoja = wb.getWorksheet(item.hoja) ?? wb.addWorksheet(item.hoja)
    const campo = mapeo.get(item.etiqueta)
    hoja.getCell(item.celda_etiqueta).value = item.etiqueta
    hoja.getCell(item.celda_etiqueta).font = { bold: true }
    const celda = hoja.getCell(item.celda_valor)
    celda.value = campo?.valor ?? ""
    if (!campo || campo.estado === "faltante") celda.note = "FALTANTE: no existe en el repositorio maestro. Diligenciar manualmente."
    else if (campo.estado === "requiere_confirmacion") celda.note = `REQUIERE CONFIRMACIÓN: ${campo.nota ?? ""}`
  }
  wb.eachSheet((hoja) => {
    hoja.columns.forEach((col) => (col.width = 32))
  })
  const buffer = await wb.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

/** Divide un texto en líneas que caben en el ancho dado. */
function envolver(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(/\s+/)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tamano) > ancho && actual) {
      lineas.push(actual)
      actual = palabra
    } else actual = prueba
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : [""]
}

/** PDF generado (no AcroForm) con todos los campos, etiqueta y valor, en el orden de la plantilla. */
export async function generarPdf(titulo: string, cliente: string, filas: Fila[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(titulo)
  pdf.setCreator("Agente Registro Proveedor")
  pdf.setProducer("pdf-lib")
  pdf.setCreationDate(FECHA_FIJA)
  pdf.setModificationDate(FECHA_FIJA)
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)

  const [anchoPag, altoPag] = [595, 842] // A4
  const margen = 50
  const colValor = 240
  let pagina = pdf.addPage([anchoPag, altoPag])
  let y = altoPag - margen

  const nuevaLinea = (alto: number) => {
    if (y - alto < margen + 60) {
      pagina = pdf.addPage([anchoPag, altoPag])
      y = altoPag - margen
    }
  }

  pagina.drawText(titulo, { x: margen, y, size: 15, font: negrita })
  y -= 20
  pagina.drawText(`Cliente: ${cliente}`, { x: margen, y, size: 10, font: normal, color: rgb(0.3, 0.3, 0.3) })
  y -= 26

  for (const fila of filas) {
    const c = fila.campo
    const valor = !c || c.estado === "faltante" ? "[PENDIENTE - no disponible en el maestro]" : c.valor ?? ""
    const lineas = envolver(valor, normal, 10, anchoPag - margen - colValor)
    nuevaLinea(lineas.length * 14 + 8)
    const etiqueta = `${fila.etiqueta}${fila.obligatorio ? " *" : ""}`
    for (const [i, l] of envolver(etiqueta, negrita, 10, colValor - margen - 10).entries()) {
      pagina.drawText(l, { x: margen, y: y - i * 14, size: 10, font: negrita })
    }
    const color = !c || c.estado === "faltante" ? rgb(0.75, 0.1, 0.1) : rgb(0, 0, 0)
    lineas.forEach((l, i) => pagina.drawText(l, { x: colValor, y: y - i * 14, size: 10, font: normal, color }))
    y -= lineas.length * 14 + 8
    pagina.drawLine({ start: { x: margen, y: y + 4 }, end: { x: anchoPag - margen, y: y + 4 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) })
  }

  nuevaLinea(80)
  y -= 50
  pagina.drawLine({ start: { x: margen, y }, end: { x: margen + 220, y }, thickness: 0.8 })
  pagina.drawText("Firma del representante legal", { x: margen, y: y - 14, size: 9, font: normal })
  pagina.drawText("* Campo obligatorio", { x: anchoPag - margen - 100, y: y - 14, size: 8, font: normal, color: rgb(0.4, 0.4, 0.4) })
  return pdf.save({ useObjectStreams: false })
}

/** Valores listos para copiar en un portal web (formato no soportado para automatización). */
export function generarValoresPortal(cliente: string, url: string | null, filas: Fila[]): string {
  const lineas = [
    `# Valores para el portal de ${cliente}`,
    "",
    "> Formato **portal web**: no se automatiza. Copia estos valores en el portal.",
    "> El ingreso de credenciales y el clic en **Enviar** los hace una persona.",
    url ? `> Portal indicado en el correo: ${url}` : "",
    "",
    "| Campo | Valor | Estado |",
    "|---|---|---|",
    ...filas.map((f) => {
      const c = f.campo
      const valor = !c || c.estado === "faltante" ? "—" : `\`${c.valor}\``
      const estado = !c ? "faltante" : c.estado
      return `| ${f.etiqueta}${f.obligatorio ? " *" : ""} | ${valor} | ${estado}${c?.nota ? ` — ${c.nota}` : ""} |`
    }),
    "",
  ]
  return lineas.filter((l, i) => l !== "" || lineas[i - 1] !== "").join("\n")
}
