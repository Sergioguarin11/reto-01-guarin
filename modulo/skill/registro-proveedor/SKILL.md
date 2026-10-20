---
name: registro-proveedor
description: Conocimiento del proceso de registro de Periferia como proveedor ante clientes de CO, EC, PE, PA y HN (identificadores tributarios, soportes, vigencias y cierre humano).
---

# Conocimiento: registro de Periferia como proveedor

## Para qué sirve el proceso
Los clientes (Colombia, Ecuador, Perú, Panamá, Honduras) piden registrar a Periferia como proveedor antes de poder facturar. Llegan 8–12 solicitudes al mes por correo. La información es casi siempre la misma y vive en el repositorio maestro.

## Formatos de salida
- **xlsx**: plantilla Excel del cliente. Se escribe cada etiqueta y su valor en la hoja y celda indicadas.
- **pdf**: formulario PDF. Se genera un PDF con todos los campos en el orden de la plantilla.
- **portal**: portal web con usuario y contraseña. No se automatiza: se entregan los valores listos para copiar. Credenciales y clic en "Enviar" son humanos.

## Identificador tributario por país
| País | Identificador |
|---|---|
| CO | NIT |
| EC, PE, PA | RUC |
| HN | RTN |

Periferia solo tiene NIT colombiano. Para clientes fuera de Colombia el campo se llena con el NIT y queda en `requiere_confirmacion` ("identificador extranjero"). La analista confirma con el cliente si lo acepta.

## Estados de un campo
- `lleno`: tiene valor en el maestro (se indica la ruta, p. ej. `maestro.json#banco.swift`).
- `faltante`: no existe en el maestro. No bloquea la firma, pero se diligencia a mano.
- `requiere_confirmacion`: mapeo con confianza < 0.8, etiqueta ambigua o regla de país.

## Soportes
- Un soporte con `vigencia_hasta` anterior a la fecha de ejecución está **vencido** y bloquea `listo_para_firma`.
- Un soporte exigido que no existe está **ausente** y también bloquea.
- La Cámara de Comercio tiene vigencia corta (30 días): es el soporte que más se vence.
- Los soportes de Periferia son colombianos. Si el cliente pide "registro tributario de su país", se entrega el RUT colombiano y se valida con el cliente.

## Cierre
1. La analista revisa el checklist y los campos por confirmar.
2. El representante legal firma.
3. Una persona envía. En este sistema, "enviar" solo genera `ENVIO-SIMULADO.md` tras confirmación explícita.
