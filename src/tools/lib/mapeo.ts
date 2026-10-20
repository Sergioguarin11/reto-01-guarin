// Lógica pura de mapeo etiqueta → clave del maestro. Sin E/S: fácil de probar y de explicar.
import type { CampoMapeado, Reglas } from "./esquemas.ts"

/** Minúsculas, sin tildes, sin signos: "Razón  Social:" → "razon social". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Similitud de Dice sobre bigramas de caracteres (0 a 1). Determinista y sin dependencias. */
export function similitud(a: string, b: string): number {
  const x = normalizar(a).replace(/ /g, "")
  const y = normalizar(b).replace(/ /g, "")
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const bigramas = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const bx = bigramas(x)
  const by = bigramas(y)
  let comunes = 0
  for (const [g, n] of bx) comunes += Math.min(n, by.get(g) ?? 0)
  return (2 * comunes) / (x.length - 1 + y.length - 1)
}

export type Resolucion = { clave: string; confianza: number; metodo: string; sinonimo: string }

/** Busca la clave del maestro para una etiqueta: glosario exacto → glosario normalizado → similitud. */
export function resolverClave(etiqueta: string, glosario: Record<string, string>): Resolucion | null {
  const exacta = glosario[etiqueta]
  if (exacta) return { clave: exacta, confianza: 1, metodo: "glosario", sinonimo: etiqueta }

  const n = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === n) return { clave, confianza: 0.95, metodo: "glosario_normalizado", sinonimo }
  }

  let mejor: Resolucion | null = null
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    const s = similitud(etiqueta, sinonimo)
    if (!mejor || s > mejor.confianza) mejor = { clave, confianza: Math.round(s * 100) / 100, metodo: "similitud", sinonimo }
  }
  return mejor
}

/** Lee una ruta con puntos ("banco.swift") dentro del maestro. */
export function leerRuta(obj: Record<string, unknown>, ruta: string): unknown {
  let actual: unknown = obj
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

const miles = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

/** Convierte el valor del maestro a texto. Solo formatea; nunca agrega datos que no existan. */
export function formatearValor(maestro: Record<string, unknown>, ruta: string, valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === "") return null
  if (typeof valor === "number") {
    // Montos tipo { valor, moneda, ano }: se acompañan de su moneda y año, que también vienen del maestro.
    if (ruta.endsWith(".valor")) {
      const padre = leerRuta(maestro, ruta.slice(0, -".valor".length))
      if (padre && typeof padre === "object") {
        const p = padre as Record<string, unknown>
        const sufijo = [p.moneda, p.ano ? `(${p.ano})` : ""].filter(Boolean).join(" ")
        return `${miles(valor)} ${sufijo}`.trim()
      }
    }
    return String(valor)
  }
  if (typeof valor === "string") return valor
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  if (Array.isArray(valor) && valor.every((v) => typeof v === "string")) return valor.join(", ")
  return null // objetos compuestos: no se aplanan para no inventar formato
}

/** Mapea una etiqueta a uno de los tres estados: lleno, faltante o requiere_confirmacion. */
export function mapearEtiqueta(
  etiqueta: string,
  paisCliente: string,
  maestro: Record<string, unknown>,
  glosario: Record<string, string>,
  reglas: Reglas,
): CampoMapeado {
  const r = resolverClave(etiqueta, glosario)
  const base = { etiqueta, valor: null, ruta: null, confianza: r?.confianza ?? 0, bancario: false }

  if (!r || r.confianza < reglas.umbral_confianza_sugerencia) {
    return { ...base, estado: "faltante", nota: "No existe en el glosario ni en el maestro." }
  }

  const valor = formatearValor(maestro, r.clave, leerRuta(maestro, r.clave))
  const ruta = `maestro.json#${r.clave}`
  const bancario = reglas.claves_bancarias.includes(r.clave)

  if (valor === null) {
    return { ...base, ruta, bancario, estado: "faltante", nota: `La clave "${r.clave}" no tiene valor en el maestro.` }
  }

  const lleno = { etiqueta, valor, ruta, confianza: r.confianza, bancario }

  // RN1: identificador tributario según el país del cliente.
  const esIdTributario = reglas.etiquetas_identificador_tributario.some((e) => normalizar(e) === normalizar(r.sinonimo))
  if (esIdTributario) {
    const esperado = reglas.identificador_tributario_por_pais[paisCliente] ?? "identificador tributario"
    if (paisCliente !== reglas.pais_del_maestro) {
      return { ...lleno, estado: "requiere_confirmacion", nota: `Identificador extranjero: ${paisCliente} usa ${esperado}; Periferia solo tiene NIT colombiano. Se llenó con el NIT.` }
    }
    if (reglas.etiquetas_ambiguas.some((e) => normalizar(e) === normalizar(etiqueta))) {
      return { ...lleno, estado: "requiere_confirmacion", nota: `Etiqueta ambigua. Equivalente propuesto para ${paisCliente}: ${esperado}.` }
    }
  }

  if (r.confianza < reglas.umbral_confianza_lleno) {
    return { ...lleno, estado: "requiere_confirmacion", nota: `Mapeo por similitud con "${r.sinonimo}" (confianza ${r.confianza}).` }
  }

  return { ...lleno, estado: "lleno" }
}
