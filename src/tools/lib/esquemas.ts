// Esquemas zod de los archivos de entrada (fixtures). Validar la entrada es lo que permite
// detectar plantillas corruptas y responder con un error claro en lugar de una traza.
import { z } from "zod"

export const Formato = z.enum(["xlsx", "pdf", "portal"])

export const Solicitud = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.string(),
  adjuntos: z.array(z.string()).default([]),
})
export type Solicitud = z.infer<typeof Solicitud>

export const PlantillaCeldas = z.array(
  z.object({
    hoja: z.string().min(1),
    celda_etiqueta: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/, "celda inválida"),
    etiqueta: z.string().min(1),
    celda_valor: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/, "celda inválida"),
  }),
).min(1, "la plantilla no tiene campos")
export type PlantillaCeldas = z.infer<typeof PlantillaCeldas>

export const PlantillaCampos = z.array(
  z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean().default(false) }),
).min(1, "la plantilla no tiene campos")
export type PlantillaCampos = z.infer<typeof PlantillaCampos>

export const SoportesExigidos = z.array(z.string())

export const IndiceSoportes = z.array(
  z.object({
    tipo: z.string(),
    archivo: z.string(),
    vigencia_hasta: z.string().nullable(),
    pais_emisor: z.string(),
    descripcion: z.string().optional(),
  }),
)
export type IndiceSoportes = z.infer<typeof IndiceSoportes>

export const Glosario = z.record(z.string(), z.string())
export const Maestro = z.record(z.string(), z.unknown())

export const Reglas = z.object({
  identificador_tributario_por_pais: z.record(z.string(), z.string()),
  pais_del_maestro: z.string(),
  etiquetas_identificador_tributario: z.array(z.string()),
  etiquetas_ambiguas: z.array(z.string()),
  claves_bancarias: z.array(z.string()),
  umbral_confianza_lleno: z.number(),
  umbral_confianza_sugerencia: z.number(),
  nombres_soportes: z.record(z.string(), z.string()),
})
export type Reglas = z.infer<typeof Reglas>

export const EstadoCampo = z.enum(["lleno", "faltante", "requiere_confirmacion"])

export const CampoMapeado = z.object({
  etiqueta: z.string(),
  estado: EstadoCampo,
  valor: z.string().nullable(),
  ruta: z.string().nullable(), // ruta del dato en el maestro, p.ej. maestro.json#banco.swift
  confianza: z.number(),
  nota: z.string().optional(),
  bancario: z.boolean(),
})
export type CampoMapeado = z.infer<typeof CampoMapeado>

export const ArchivoMapeo = z.object({
  caso: z.string(),
  pais: z.string(),
  generado: z.string(),
  campos: z.array(CampoMapeado),
})
export type ArchivoMapeo = z.infer<typeof ArchivoMapeo>

export const EstadoPaquete = z.object({
  caso: z.string(),
  listo_para_firma: z.boolean(),
  bloqueos: z.array(z.string()),
  archivos: z.array(z.string()),
  destinatario: z.string(),
  asunto: z.string(),
})
export type EstadoPaquete = z.infer<typeof EstadoPaquete>
