# SOLUCIÓN · Reto 01 — Agente "Registro como Proveedor"

**Autor:** Sergio Guarín Valencia · **Repositorio:** https://github.com/Sergioguarin11/reto-01-guarin · **Link:** https://agente-proveedor.calmwater-0e4a7472.eastus2.azurecontainerapps.io · **Telegram:** [@periferia_proveedor_sergio_bot](https://t.me/periferia_proveedor_sergio_bot)

---

## 1. Problema en una frase

La analista administrativa transcribe a mano, en cada uno de los 8–12 registros mensuales, datos que ya existen en un repositorio, con riesgo de error en datos sensibles (NIT, cuenta bancaria) y dependencia de una sola persona. **Le duele a la analista** (retrabajo), **a la empresa** (facturación que se retrasa días) y **al proceso** (conocimiento no sistematizado que se va con la persona).

## 2. Arquitectura

```
┌──────────────────┐  HTTP JSON   ┌────────────────────────────────────────────┐
│ web/index.html   │ ───────────▶ │ src/server.ts  (Bun)                       │
│ chat, historial, │ ◀─────────── │  /api/chat · /api/sessions · /api/health   │
│ herramientas,    │              │  topes, clave de acceso opcional, sesiones │
│ confirmación     │              └───────────────┬────────────────────────────┘
└──────────────────┘                              │
                                  ┌───────────────▼────────────────┐
                                  │ src/agent.ts — ciclo del agente │
                                  │  confirmación humana, topes     │
                                  └──────┬─────────────────┬────────┘
                                         │                 │
                     ┌───────────────────▼───┐   ┌─────────▼──────────────────┐
                     │ src/llm/adapter.ts    │   │ src/tools/registro.ts      │
                     │  interfaz propia      │   │  descubre, valida (zod),   │
                     │ src/llm/gemini.ts     │   │  ejecuta y registra logs   │
                     └───────────────────────┘   └─────────┬──────────────────┘
                                                           │
                                             ┌─────────────▼─────────────┐
                                             │ src/tools/proveedor.ts    │
                                             │ (5 herramientas)          │
                                             └──────┬──────────────┬─────┘
                                                    │              │
                                     fixtures/ (solo lectura)   out/ (escritura)
```

| Capa | Dónde vive | Qué cambia si cambia el negocio |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Tono, flujo, cuándo pedir confirmación |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` y `src/knowledge/reglas.json` | Identificador por país, umbrales de confianza, claves bancarias, nombres de soportes |
| **Ejecución** | `src/tools/` | Solo si cambia *cómo* se hace algo (p. ej. un nuevo formato) |

Un cambio de reglas (por ejemplo, Perú pasa a usar otro identificador, o el umbral de confianza sube a 0.85) se hace en `reglas.json` sin tocar el servidor ni las herramientas. El prompt y el conocimiento se leen en cada turno, sin reiniciar.

**Despliegue:** GitHub Actions (typecheck + `demo.ts` + verificación del módulo) → imagen en GitHub Container Registry → Azure Container Apps, con la clave del modelo como *secret* de Azure.

## 3. Ciclo del agente

`src/agent.ts → ejecutarTurno()`:

1. Agrega el mensaje del usuario al historial.
2. Llama al modelo con el system prompt (prompt + conocimiento + fecha) y las 5 herramientas (JSON Schema generado desde zod).
3. Si el modelo pide herramientas, `registro.ts` valida los argumentos con zod (si fallan, el error vuelve al modelo), ejecuta, registra en `out/log.jsonl` y `out/<caso>/log.jsonl`, y devuelve el resultado al modelo.
4. Repite hasta que el modelo responda sin pedir herramientas.

**Topes (CA1 y costo):**
- `MAX_ITERACIONES` (25) por turno: al alcanzarlo, el agente responde con lo que hizo y lo que falta.
- `MAX_TOKENS_SESION` por sesión y `MAX_TURNOS_DIA` global: nadie puede gastar la clave sin límite.
- `LLM_TIMEOUT_MS`: timeout al proveedor con mensaje claro.

**Confirmación humana (CA3 / RN4), en dos capas:**
1. *Prompt*: el agente debe terminar con la línea `❓ Confirmación requerida:` antes de cualquier acción externa. El servidor detecta esa marca y devuelve `needsConfirmation: true`; el front resalta el mensaje en ámbar y muestra los botones **Sí, confirmo / No**.
2. *Servidor*: el siguiente mensaje solo cuenta como confirmación si el turno anterior la pidió **y** el texto es afirmativo explícito ("sí", "confirmo", "envía"…, sin negaciones). El servidor pasa `confirmacionHumana` en el contexto de la herramienta; `proveedor_simular_envio` lo exige además de `confirmado: true`. **El modelo no puede saltarse la confirmación aunque quiera**: si lo intenta, la herramienta responde `requiere confirmación explícita`.

**Errores (CA5):** un error del modelo (timeout, clave inválida, límite 429) se muestra en el chat en lenguaje claro y la sesión sigue viva. Ninguna herramienta lanza excepciones: todas devuelven `{ ok, data }` o `{ ok: false, error }` (envoltura `seguro()` + validación en `registro.ts`).

**Regla CA2 (no inventar):** además de prohibirlo en el prompt, el diseño lo hace innecesario: el modelo nunca transporta valores. `mapear_campos` guarda el mapeo en `out/<caso>/mapeo.json` y `generar_formulario` lo lee de disco; el modelo solo pasa el nombre del caso.

## 4. Elección del modelo

| | |
|---|---|
| **Proveedor / modelos** | Google Gemini (API REST `generateContent`) con **rotación de modelos**: `gemini-3-flash-preview` → `gemini-3.5-flash-lite` → `gemini-3.7-flash` → `gemini-3.1-flash-lite` → `gemini-3.5-flash`, configurable con `LLM_MODEL` |
| **Por qué** | Llamadas a herramientas confiables, baja latencia, nivel gratuito sin tarjeta (suficiente para la prueba y la defensa) |
| **Por qué no un SDK** | REST directo: una dependencia menos y control explícito de las `thoughtSignature`, que Gemini exige reenviar intactas entre llamadas a herramientas (se guardan en `crudo` dentro del historial) |
| **Cambio de proveedor** | Implementar `LLMAdapter` (`enviar(sistema, mensajes, herramientas)`) y elegirlo con `LLM_PROVIDER`. El ciclo del agente no cambia |
| **Lecciones aplicadas** | (1) `gemini-3.8-flash` respondió 503 por alta demanda y superó 60 s: medí la latencia de varios modelos y cambié **por variable de entorno, sin tocar código**. (2) El plan gratuito permite **20 consultas por día y por modelo** (un caso usa 5–6), y lo agotamos en pruebas. Implementé **rotación automática**: ante 429 (cupo), 503 (saturación) o lentitud, el adaptador pasa al siguiente modelo y recuerda hasta cuándo evitar el agotado. Medí qué nombres son alias del mismo modelo (comparten cupo) para que la lista tenga 5 cupos independientes (~15–20 casos al día). (3) Al cambiar de modelo a mitad de conversación, las firmas de razonamiento del modelo anterior se marcan como externas, según la documentación de Gemini. |

**Costo estimado por caso procesado.** Un caso completo usa ~5–6 llamadas al modelo (leer → mapear → generar → paquete → resumen). Cada llamada lleva el system prompt (~2.000 tokens) más el historial con los resultados de herramientas, que crece hasta ~6.000 tokens. Estimado: **25.000–40.000 tokens por caso**. El valor real se ve en `tokensSesion`, que devuelve `/api/chat`.
- En el nivel gratuito de Gemini: **USD 0**, con un límite de 20 consultas por día y por modelo (de ahí la rotación).
- En un modelo "flash" pago (del orden de USD 0,30–0,50 por millón de tokens de entrada): **menos de USD 0,02 por caso**, es decir, menos de USD 0,25 al mes para 12 casos.
- Infraestructura (Container Apps, escala a cero): centavos al mes con este volumen.

## 5. Diseño del portal web (formato `portal`, no implementado)

**Hoy:** el agente responde *formato no soportado* y genera `out/<caso>/valores-portal.md` con cada campo, su valor y su estado, listo para copiar.

**Diseño propuesto (fase 2):**

| Tema | Decisión |
|---|---|
| **Estrategia** | Navegador controlado por el agente (Playwright) en modo **asistido**: el agente abre el portal y llena campos; la persona ve la sesión en vivo. Para un portal recurrente con layout estable, un *script* Playwright específico por cliente (más robusto que la navegación libre del LLM). RPA tradicional se descarta: es caro de mantener para 8–12 registros al mes. Una extensión de navegador es la alternativa si el portal bloquea navegadores automatizados. |
| **Límites** | **CAPTCHA**: no se evade; lo resuelve la persona. **MFA**: lo completa la persona (el código llega a su teléfono o correo). **Cambios de layout**: selectores por etiqueta visible (`getByLabel`) y no por posición; si un campo no se encuentra, el agente se detiene y reporta, nunca adivina. |
| **Credenciales** | Nunca en el repositorio, el prompt ni los logs. Viven en un gestor de secretos (Azure Key Vault) o, mejor, **no se almacenan**: el correo del cliente las envía al representante legal y **la persona las digita** directamente en el navegador. El agente nunca las ve; los logs registran "credenciales ingresadas por humano", no el valor. |
| **Reparto agente / humano** | **Agente:** abrir el portal, navegar al formulario, llenar campos desde el mapeo, adjuntar soportes vigentes, tomar captura final para el checklist. **Humano (mínimo):** ingresar credenciales, resolver CAPTCHA/MFA, revisar y hacer **clic en "Enviar"**. |
| **Trazabilidad** | Captura de pantalla antes del envío dentro del paquete; registro de cada campo llenado en `log.jsonl`. |

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Mapeo determinista** (glosario exacto → glosario normalizado → similitud de Dice por bigramas, con umbrales en `reglas.json`) | Pedirle al LLM que mapee cada etiqueta | El mapeo es la parte crítica (datos bancarios, NIT). Debe ser trazable (ruta en el maestro), reproducible y funcionar en `demo.ts` sin modelo. El LLM orquesta y explica; no decide valores. |
| 2 | **El modelo no transporta valores**: `generar_formulario` lee `out/<caso>/mapeo.json`; el argumento `mapeo` es solo una ruta opcional y se valida | Recibir el mapeo completo como argumento (contrato literal del PRD) | Si el modelo pasa los valores, puede alterarlos o "completarlos". Así se cumple CA2 por diseño. Es una desviación consciente del contrato: `mapeo` existe, pero como referencia. |
| 3 | **Confirmación validada por el servidor** (`ctx.confirmacionHumana`) | Confiar en el argumento `confirmado: true` que envía el modelo | El modelo podría poner `true` sin que la persona confirme (alucinación o prompt injection). La regla RN4 tiene que ser imposible de saltar, no solo improbable. |
| 4 | **Azure Container Apps** con imagen construida en **GitHub Actions** (publicada en GHCR) | App Service (cuota de VMs en 0 en la suscripción) · Azure Functions · construir en Azure con ACR Tasks (no permitido en suscripción de prueba) | Container Apps no consume esa cuota y sirve el chat y la API en un solo servicio. Construir en GitHub agrega una compuerta de calidad: cada push corre typecheck, `demo.ts` y la verificación del módulo antes de publicar. |
| 5 | **PDF generado** con pdf-lib (no AcroForm) y **Excel nuevo** con exceljs escrito celda por celda | Rellenar los binarios originales del cliente | Los fixtures traen el mapa de celdas y campos, no los binarios; el PRD acepta PDF generado. Ambas librerías son 100% JS (sin LibreOffice). |
| 6 | **Envío simulado permitido con bloqueos**, con advertencia explícita en la pregunta y en `ENVIO-SIMULADO.md` | Bloquear el envío si no está `listo_para_firma` | El PRD espera que "envía" produzca el archivo tras confirmación; la decisión es humana y el agente se asegura de que sea informada. En producción lo dejaría configurable. |
| 7 | **Chat web como canal principal + Telegram como canal adicional** | Solo Teams o solo Telegram (el patrón que usé antes en un bot de certificados laborales) | El PRD exige mostrar cada herramienta y resaltar la confirmación, y eso lo cumple el chat web. Para demostrar que el agente no depende del canal, extraje el servicio (`src/servicio.ts`) y agregué Telegram como adaptador de ~200 líneas: mismas herramientas, misma confirmación validada en el servidor (con botones) y entrega de archivos. Teams sería otro adaptador igual. |

## 7. Supuestos

1. **Fecha de ejecución = hoy (America/Bogota)**, configurable con `FECHA_EJECUCION`. Con la fecha de entrega (octubre de 2026), la Cámara de Comercio (vigente hasta 2026-09-30) está vencida en todos los casos: **ningún paquete queda listo para firma** y el agente lo reporta como soporte a actualizar.
2. `requiere_confirmacion` **no bloquea** `listo_para_firma` (RN3 solo menciona soportes); aparece en el checklist para revisión humana.
3. Los valores se escriben tal como están en el maestro (p. ej. `País: CO`). La única transformación es dar formato a los montos con su moneda y año, también del maestro (`98.000.000.000 COP (2025)`).
4. "Correo electrónico" se llena con el correo comercial, según el glosario.
5. Los soportes de Periferia son colombianos. Cuando el cliente es extranjero, se incluyen con una nota "validar si lo acepta" en lugar de marcarlos como ausentes.
6. El formulario Excel se crea nuevo (no hay binario del cliente), respetando hoja y celda exactas. Los campos faltantes quedan vacíos con una nota de celda; los que requieren confirmación llevan la nota con el motivo.
7. Para `portal`, se usa `plantilla-campos.json` como lista de campos del portal.
8. El contenido libre del correo (`cuerpo`) **no se le entrega al modelo**: solo campos estructurados. Así se reduce el riesgo de *prompt injection* desde correos de terceros.

## 8. Cobertura

| Historia | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| HU-1 Leer solicitud | Hecho | `proveedor_leer_solicitud`; etiquetas ambiguas con propuesta por país | Lectura de los adjuntos reales (xlsx/pdf del cliente) |
| HU-2 Mapear campos | Hecho | 3 estados, ruta en el maestro, glosario + similitud, RN1 | Revisión periódica del glosario con nuevas etiquetas reales |
| HU-3 Generar formulario | Hecho: xlsx (P0), pdf (P1), portal → valores (P2) | `out/<caso>/formulario.*` | Rellenar el binario original del cliente; automatización del portal (sección 5) |
| HU-4 Paquete para firma | Hecho | `paquete/` con formulario, soportes, `checklist.md`, `borrador-correo.md`; vencidos bloquean | Integración con firma electrónica y correo real |
| HU-5 Manejo de errores | Hecho | Caso inexistente, ruta maliciosa, plantilla corrupta, argumentos inválidos y errores del modelo (ver `demo.ts`) | Alertas operativas (Application Insights) |
| Bonus módulo | Hecho | `modulo/` generado desde las mismas fuentes (`bun run modulo --check` verifica que no diverjan) | Publicarlo como paquete versionado |

## 9. Uso de IA

| Quién | Para qué |
|---|---|
| **Claude (Anthropic), en la app de Claude** | Lectura del PRD y los fixtures, propuesta de arquitectura, generación del código TypeScript (herramientas, ciclo del agente, adaptador, chat web, canal Telegram), de esta documentación y del backlog, y guía paso a paso para GitHub, Azure y Azure DevOps. |
| **Yo (decisiones de producto, revisión y operación)** | Elegí el reto y el stack. Propuse sumar Telegram como segundo canal (a partir de mi experiencia previa con un bot en Teams) y gestionar el producto con un backlog Scrum en Azure DevOps. Pedí simplificar la interfaz hacia una experiencia minimalista. Ante el límite del plan gratuito de Gemini, elegí la rotación de modelos en lugar del plan de pago para la prueba. Ejecuté `demo.ts` y el chat en local, desplegué en Azure, probé el link y el bot, y validé los resultados contra el PRD. |

**Qué descarté de lo propuesto y por qué:**
- **Azure App Service**: la suscripción tiene cuota 0 de VMs → Container Apps.
- **Construir la imagen en Azure (ACR Tasks)**: no permitido en suscripción de prueba → GitHub Actions + GHCR.
- **Teams o Telegram como único canal**: no cumple el requisito de mostrar herramientas y confirmación → chat web como canal principal y Telegram como canal adicional sobre el mismo servicio.
- **Un solo modelo fijo**: `gemini-2.5-flash` está retirado para cuentas nuevas, `gemini-3.8-flash` se saturó (503 y timeouts) y el plan gratuito limita a 20 consultas diarias por modelo → rotación automática entre 5 modelos medidos.
- **Activar el plan de pago de Gemini**: era la opción más confiable, pero preferí no depender de una tarjeta para la prueba; queda como recomendación de producción.
- **Que el LLM haga el mapeo o reciba el mapeo completo como argumento**: no es trazable ni reproducible → mapeo determinista y valores leídos del disco.
- **Confiar solo en `confirmado: true`**: fácil de saltar → validación en el servidor.
- **Recibir solicitudes nuevas escritas en Telegram**: fuera del alcance del PRD y con más riesgo de error → quedó como PBI del backlog.

## 10. Riesgos de llevarlo a producción

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El modelo "completa" un dato faltante | Alto (dato falso en un formulario firmado) | Valores solo desde herramientas; el modelo nunca transporta valores; checklist con faltantes y revisión humana antes de firma |
| Maestro desactualizado (NIT, cuenta, representante) | Alto | Dueño del dato designado, fecha de última actualización por campo, alerta si tiene más de N días |
| Datos sensibles enviados al proveedor del LLM (cuenta bancaria, cédula) | Medio | Plan pago sin entrenamiento con datos o Azure OpenAI en el tenant; opción de enmascarar valores bancarios hacia el modelo (no los necesita para orquestar) |
| *Prompt injection* desde correos de clientes | Medio | El cuerpo libre no llega al modelo; confirmación validada en el servidor; herramientas sin shell ni red |
| Soportes vencidos que nadie renueva | Medio | Alertas proactivas de vencimiento (la Cámara de Comercio vence cada 30 días) |
| Sesiones y `out/` en el disco efímero del contenedor | Bajo en piloto, alto en producción | Azure Blob Storage para archivos y Table Storage para sesiones; política de ciclo de vida |
| Límites, saturación o retiro de modelos (ocurrió tres veces durante este reto: modelo retirado, saturación 503 y cupo diario gratuito) | Alto en plan gratuito | Implementado: rotación automática entre 5 modelos con memoria de cupos. **En producción: plan de pago** (USD 0,01–0,02 por caso, límites altos) o Azure OpenAI en el tenant, y un segundo proveedor como respaldo |
| Acceso público al link | Medio | `ACCESS_KEY`; en producción, SSO con Entra ID y roles |
| Portales con CAPTCHA, MFA o cambios de layout | Medio | Modo asistido: la persona opera las credenciales y el envío (sección 5) |
