// Herramientas del agente "Registro como Proveedor".
// Cada export es una herramienta; el modelo la ve como proveedor_<export>.
// Son la ÚNICA fuente de valores que el agente puede afirmar.
import { z } from "zod"
import { rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { type Herramienta, type ToolCtx, ok, fail, seguro, rutas, validarCaso, leerJson, escribir, fechaEjecucion, relativa } from "./lib/base.ts"
import * as E from "./lib/esquemas.ts"
import { mapearEtiqueta } from "./lib/mapeo.ts"
import { generarXlsx, generarPdf, generarValoresPortal, type Fila } from "./lib/documentos.ts"
import { evaluarSoportes, bloqueos, checklistMd, borradorCorreoMd } from "./lib/paquete.ts"

const argCaso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, por ejemplo ec-corp-andina")

type Campo = { etiqueta: string; obligatorio: boolean; hoja?: string; celda_valor?: string }

/** Carga solicitud + plantilla de un caso. Compartido por varias herramientas. */
async function cargarCaso(caso: string, ctx: ToolCtx) {
  const v = validarCaso(caso, ctx)
  if (!v.ok) return v
  const dir = v.data
  const sol = await leerJson(join(dir, "solicitud.json"), E.Solicitud, "solicitud.json")
  if (!sol.ok) return sol
  const formato = E.Formato.safeParse(sol.data.formato)
  if (!formato.success) return { ok: false as const, error: `Formato no soportado: "${sol.data.formato}". Formatos válidos: xlsx, pdf, portal.` }

  let campos: Campo[] = []
  let celdas: E.PlantillaCeldas | null = null
  if (formato.data === "xlsx") {
    const p = await leerJson(join(dir, "plantilla-celdas.json"), E.PlantillaCeldas, "plantilla-celdas.json")
    if (!p.ok) return p
    celdas = p.data
    campos = p.data.map((c) => ({ etiqueta: c.etiqueta, obligatorio: true, hoja: c.hoja, celda_valor: c.celda_valor }))
  } else {
    const p = await leerJson(join(dir, "plantilla-campos.json"), E.PlantillaCampos, "plantilla-campos.json")
    if (!p.ok && formato.data === "pdf") return p
    campos = p.ok ? p.data.map((c) => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio })) : []
  }
  return { ok: true as const, data: { sol: sol.data, formato: formato.data, campos, celdas, dir } }
}

async function cargarReglas(ctx: ToolCtx) {
  return leerJson(rutas(ctx).reglas, E.Reglas, "src/knowledge/reglas.json")
}

// ---------------------------------------------------------------------------------------------

export const leer_solicitud: Herramienta<{ caso: typeof argCaso }> = {
  description: "Lee el correo y la plantilla de un caso y devuelve país, cliente, formato de salida, campos solicitados y soportes exigidos.",
  args: { caso: argCaso },
  execute: seguro(async ({ caso }, ctx) => {
    const c = await cargarCaso(caso, ctx)
    if (!c.ok) return fail(c.error)
    const reglas = await cargarReglas(ctx)
    if (!reglas.ok) return fail(reglas.error)
    const exigidos = await leerJson(join(c.data.dir, "soportes-exigidos.json"), E.SoportesExigidos, "soportes-exigidos.json")
    const { sol } = c.data
    const idPais = reglas.data.identificador_tributario_por_pais[sol.pais] ?? "identificador tributario"

    const requiere_confirmacion = c.data.campos
      .filter((f) => reglas.data.etiquetas_ambiguas.includes(f.etiqueta))
      .map((f) => ({ etiqueta: f.etiqueta, propuesta: idPais, motivo: `Etiqueta ambigua; en ${sol.pais} el equivalente es ${idPais}.` }))

    return ok({
      caso,
      pais: sol.pais,
      cliente: sol.cliente,
      remitente: sol.de,
      asunto: sol.asunto,
      fecha_solicitud: sol.fecha,
      formato: c.data.formato,
      identificador_tributario_pais: idPais,
      campos: c.data.campos,
      soportes: exigidos.ok ? exigidos.data : [],
      requiere_confirmacion,
      advertencias: [
        ...(exigidos.ok ? [] : [exigidos.error]),
        ...(c.data.formato === "portal" ? ["Formato portal web: no se automatiza; se generarán valores listos para copiar."] : []),
      ],
    })
  }),
}

// ---------------------------------------------------------------------------------------------

export const mapear_campos: Herramienta<{ caso: typeof argCaso; campos: z.ZodArray<z.ZodString> }> = {
  description: "Cruza cada campo solicitado con el repositorio maestro y lo clasifica en lleno, faltante o requiere_confirmacion; guarda el mapeo del caso.",
  args: {
    caso: argCaso,
    campos: z.array(z.string()).describe("Etiquetas de los campos tal como las devolvió proveedor_leer_solicitud"),
  },
  execute: seguro(async ({ caso, campos }, ctx) => {
    const c = await cargarCaso(caso, ctx)
    if (!c.ok) return fail(c.error)
    const r = rutas(ctx)
    const maestro = await leerJson(r.maestro, E.Maestro, "maestro.json")
    if (!maestro.ok) return fail(maestro.error)
    const glosario = await leerJson(r.glosario, E.Glosario, "glosario-campos.json")
    if (!glosario.ok) return fail(glosario.error)
    const reglas = await cargarReglas(ctx)
    if (!reglas.ok) return fail(reglas.error)

    const etiquetas = campos.length ? campos : c.data.campos.map((f) => f.etiqueta)
    const mapeados = etiquetas.map((e) => mapearEtiqueta(e, c.data.sol.pais, maestro.data, glosario.data, reglas.data))

    const rutaMapeo = join(r.outCaso(caso), "mapeo.json")
    await escribir(rutaMapeo, JSON.stringify({ caso, pais: c.data.sol.pais, generado: fechaEjecucion(), campos: mapeados }, null, 2))

    const sinEstado = ({ estado: _e, ...resto }: E.CampoMapeado) => resto
    return ok({
      llenos: mapeados.filter((m) => m.estado === "lleno").map(sinEstado),
      faltantes: mapeados.filter((m) => m.estado === "faltante").map((m) => ({ etiqueta: m.etiqueta, motivo: m.nota })),
      requiere_confirmacion: mapeados.filter((m) => m.estado === "requiere_confirmacion").map(sinEstado),
      ruta_mapeo: relativa(ctx, rutaMapeo),
    })
  }),
}

// ---------------------------------------------------------------------------------------------

export const generar_formulario: Herramienta<{ caso: typeof argCaso; mapeo: z.ZodOptional<z.ZodString> }> = {
  description: "Genera el formulario lleno en el formato pedido por el cliente (xlsx o pdf); para portal web produce valores listos para copiar.",
  args: {
    caso: argCaso,
    mapeo: z.string().optional().describe("Ruta del mapeo devuelta por proveedor_mapear_campos; si se omite se usa out/<caso>/mapeo.json"),
  },
  execute: seguro(async ({ caso, mapeo }, ctx) => {
    const c = await cargarCaso(caso, ctx)
    if (!c.ok) return fail(c.error)
    const r = rutas(ctx)
    // Por seguridad el mapeo solo se lee desde out/<caso>/: el modelo nunca transporta los valores.
    const rutaMapeo = join(r.outCaso(caso), "mapeo.json")
    if (mapeo && !mapeo.replace(/\\/g, "/").endsWith(`out/${caso}/mapeo.json`)) return fail("La ruta de mapeo no corresponde a este caso.")
    const m = await leerJson(rutaMapeo, E.ArchivoMapeo, "el mapeo del caso")
    if (!m.ok) return fail(`${m.error} Ejecuta primero proveedor_mapear_campos.`)

    const porEtiqueta = new Map(m.data.campos.map((x) => [x.etiqueta, x]))
    const filas: Fila[] = c.data.campos.map((f) => ({ etiqueta: f.etiqueta, obligatorio: f.obligatorio, campo: porEtiqueta.get(f.etiqueta) ?? null }))
    const pendientes = filas.filter((f) => !f.campo || f.campo.estado === "faltante").map((f) => f.etiqueta)
    const { sol, formato } = c.data

    if (formato === "xlsx" && c.data.celdas) {
      const ruta = join(r.outCaso(caso), "formulario.xlsx")
      await escribir(ruta, await generarXlsx(c.data.celdas, porEtiqueta))
      return ok({ ruta: relativa(ctx, ruta), formato, campos_escritos: filas.length - pendientes.length, pendientes })
    }
    if (formato === "pdf") {
      const ruta = join(r.outCaso(caso), "formulario.pdf")
      await escribir(ruta, await generarPdf("Formulario de registro de proveedor", sol.cliente, filas))
      return ok({ ruta: relativa(ctx, ruta), formato, campos_escritos: filas.length - pendientes.length, pendientes })
    }
    const ruta = join(r.outCaso(caso), "valores-portal.md")
    const url = sol.cuerpo.match(/https?:\/\/\S+?(?=[\s.,;)]*(\s|$))/)?.[0] ?? null
    await escribir(ruta, generarValoresPortal(sol.cliente, url, filas))
    return ok({
      ruta: relativa(ctx, ruta),
      formato,
      soportado: false,
      aviso: "Formato no soportado: portal web. Se generaron los valores listos para copiar; una persona ingresa las credenciales y envía.",
      pendientes,
    })
  }),
}

// ---------------------------------------------------------------------------------------------

export const armar_paquete: Herramienta<{ caso: typeof argCaso }> = {
  description: "Arma el paquete para firma (formulario, soportes vigentes, checklist y borrador de correo) y determina si está listo para firma.",
  args: { caso: argCaso },
  execute: seguro(async ({ caso }, ctx) => {
    const c = await cargarCaso(caso, ctx)
    if (!c.ok) return fail(c.error)
    const r = rutas(ctx)
    const reglas = await cargarReglas(ctx)
    if (!reglas.ok) return fail(reglas.error)
    const indice = await leerJson(r.soportesIndex, E.IndiceSoportes, "repositorio/soportes/index.json")
    if (!indice.ok) return fail(indice.error)
    const exigidos = await leerJson(join(c.data.dir, "soportes-exigidos.json"), E.SoportesExigidos, "soportes-exigidos.json")
    const mapeo = await leerJson(join(r.outCaso(caso), "mapeo.json"), E.ArchivoMapeo, "mapeo")
    const { sol } = c.data
    const fecha = fechaEjecucion()

    const dirPaquete = join(r.outCaso(caso), "paquete")
    await rm(dirPaquete, { recursive: true, force: true })
    // Un paquete nuevo invalida cualquier envío simulado anterior: exige una nueva confirmación.
    await rm(join(r.outCaso(caso), "ENVIO-SIMULADO.md"), { force: true })

    const nombreForm = { xlsx: "formulario.xlsx", pdf: "formulario.pdf", portal: "valores-portal.md" }[c.data.formato]
    const origenForm = join(r.outCaso(caso), nombreForm)
    const formularioPresente = existsSync(origenForm)
    const archivos: string[] = []
    if (formularioPresente) {
      await escribir(join(dirPaquete, nombreForm), await readFile(origenForm))
      archivos.push(nombreForm)
    }

    const soportes = evaluarSoportes(exigidos.ok ? exigidos.data : [], indice.data, fecha, sol.pais, reglas.data.nombres_soportes)
    for (const s of soportes.filter((x) => x.estado === "presente" && x.archivo)) {
      const origen = join(r.soportesDir, s.archivo as string)
      if (existsSync(origen)) {
        await escribir(join(dirPaquete, "soportes", s.archivo as string), await readFile(origen))
        archivos.push(`soportes/${s.archivo}`)
      }
    }

    const bloq = bloqueos(soportes, formularioPresente)
    if (!exigidos.ok) bloq.push(exigidos.error)
    const listo = bloq.length === 0
    const campos = mapeo.ok ? mapeo.data.campos : []

    await escribir(join(dirPaquete, "checklist.md"), checklistMd(sol, fecha, soportes, campos, formularioPresente ? nombreForm : null, listo, bloq))
    const adjuntos = [formularioPresente ? `Formulario diligenciado (${nombreForm})` : "", ...soportes.filter((s) => s.estado === "presente").map((s) => s.nombre)].filter(Boolean)
    await escribir(join(dirPaquete, "borrador-correo.md"), borradorCorreoMd(sol, adjuntos, listo))
    archivos.push("checklist.md", "borrador-correo.md")

    const estado: E.EstadoPaquete = { caso, listo_para_firma: listo, bloqueos: bloq, archivos, destinatario: sol.de, asunto: `RE: ${sol.asunto}` }
    await escribir(join(dirPaquete, "estado.json"), JSON.stringify(estado, null, 2))

    return ok({
      ruta: relativa(ctx, dirPaquete),
      listo_para_firma: listo,
      bloqueos: bloq,
      fecha_revision: fecha,
      checklist: {
        presentes: soportes.filter((s) => s.estado === "presente").map((s) => ({ tipo: s.tipo, nota: s.nota })),
        ausentes: soportes.filter((s) => s.estado === "ausente").map((s) => s.tipo),
        vencidos: soportes.filter((s) => s.estado === "vencido").map((s) => ({ tipo: s.tipo, vigencia_hasta: s.vigencia_hasta })),
        campos_faltantes: campos.filter((x) => x.estado === "faltante").map((x) => x.etiqueta),
        campos_por_confirmar: campos.filter((x) => x.estado === "requiere_confirmacion").map((x) => x.etiqueta),
      },
      archivos,
    })
  }),
}

// ---------------------------------------------------------------------------------------------

export const simular_envio: Herramienta<{ caso: typeof argCaso; confirmado: z.ZodBoolean }> = {
  description: "Simula el envío del paquete escribiendo ENVIO-SIMULADO.md; solo funciona si el usuario confirmó explícitamente en su último mensaje.",
  args: {
    caso: argCaso,
    confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente el envío en su último mensaje"),
  },
  execute: seguro(async ({ caso, confirmado }, ctx) => {
    // RN4 / CA3: la confirmación la valida el servidor (ctx), no la declaración del modelo.
    if (!confirmado || ctx.confirmacionHumana !== true) return fail("requiere confirmación explícita")
    const v = validarCaso(caso, ctx)
    if (!v.ok) return fail(v.error)
    const r = rutas(ctx)
    const est = await leerJson(join(r.outCaso(caso), "paquete", "estado.json"), E.EstadoPaquete, "el paquete del caso")
    if (!est.ok) return fail(`${est.error} Ejecuta primero proveedor_armar_paquete.`)
    const e = est.data
    const ruta = join(r.outCaso(caso), "ENVIO-SIMULADO.md")
    await escribir(
      ruta,
      [
        "# ENVÍO SIMULADO",
        "",
        "> No se envió ningún correo real. Este archivo deja constancia de la acción confirmada por el usuario.",
        "",
        `- Fecha: ${new Date().toISOString()}`,
        `- Sesión: ${ctx.sessionId}`,
        `- Para: ${e.destinatario}`,
        `- Asunto: ${e.asunto}`,
        `- Listo para firma: ${e.listo_para_firma ? "sí" : "NO"}`,
        ...(e.bloqueos.length ? ["", "## Advertencia: bloqueos vigentes", ...e.bloqueos.map((b) => `- ${b}`)] : []),
        "",
        "## Adjuntos",
        ...e.archivos.map((a) => `- paquete/${a}`),
        "",
      ].join("\n"),
    )
    return ok({ ruta: relativa(ctx, ruta), listo_para_firma: e.listo_para_firma, advertencia: e.listo_para_firma ? null : "Se simuló el envío con bloqueos vigentes." })
  }),
}
