# Backlog del producto — Agente de Registro como Proveedor

Proceso **Scrum** (Épica → Feature → Product Backlog Item). Fuente única: `backlog/backlog.json`, cargada también en Azure DevOps con `bun run backlog cargar`.

**Avance:** 13 de 25 PBIs terminados · 52 de 128 puntos de esfuerzo.

| Épica | Estado | PBIs | Puntos |
|---|---|---|---|
| E1 · MVP: agente de registro como proveedor | Done | 12 | 47 |
| E2 · Canales conversacionales | In Progress | 2 | 13 |
| E3 · Integración con sistemas reales | New | 5 | 42 |
| E4 · Operación, seguridad y gobierno del dato | New | 6 | 26 |

## E1 · MVP: agente de registro como proveedor

_Done._ Automatizar la preparación del registro de Periferia como proveedor ante clientes: leer la solicitud, llenar el formulario desde el repositorio maestro y armar el paquete para firma, sin inventar datos y con confirmación humana antes de cualquier acción externa.

### F1.1 · Lectura de solicitudes y mapeo de campos

#### ✅ Leer la solicitud del cliente y su plantilla

Como analista administrativa, quiero que el agente lea el correo del cliente y la plantilla adjunta, para saber qué campos y soportes me piden sin abrir cada archivo.

**Estado:** Done · **Esfuerzo:** 5 · **Prioridad:** 1 · **Valor de negocio:** 80 · `HU-1` `MVP`

Criterios de aceptación:
- Devuelve país, cliente, formato de salida, campos solicitados y soportes exigidos.
- Las etiquetas ambiguas (p. ej. 'Identificación tributaria') se reportan como requiere_confirmacion con el equivalente del país (NIT, RUC o RTN).
- Una plantilla corrupta o un caso inexistente devuelven un error claro, sin traza técnica.

#### ✅ Mapear cada campo al repositorio maestro sin inventar valores

Como analista, quiero que cada campo solicitado se cruce con el maestro, para que el llenado sea exacto y trazable.

**Estado:** Done · **Esfuerzo:** 8 · **Prioridad:** 1 · **Valor de negocio:** 100 · `HU-2` `MVP`

Criterios de aceptación:
- Cada campo termina en lleno (con la ruta del dato), faltante o requiere_confirmacion.
- Un campo sin fuente es faltante; el agente nunca inventa un valor.
- Los sinónimos del glosario se resuelven automáticamente; la similitud con confianza menor a 0.8 requiere confirmación.
- Identificador tributario de clientes fuera de Colombia: se llena con el NIT y queda en requiere_confirmacion (identificador extranjero).

### F1.2 · Generación del formulario en el formato del cliente

#### ✅ Generar el formulario en Excel

Como analista, quiero el formulario Excel lleno en las celdas exactas de la plantilla, para no reformatear nada.

**Estado:** Done · **Esfuerzo:** 5 · **Prioridad:** 1 · **Valor de negocio:** 80 · `HU-3` `P0` `MVP`

Criterios de aceptación:
- Cada etiqueta y su valor se escriben en la hoja y celda indicadas.
- Faltantes y campos por confirmar quedan señalados con una nota de celda.

#### ✅ Generar el formulario en PDF

Como analista, quiero un PDF con todos los campos en el orden de la plantilla, para enviarlo a firma.

**Estado:** Done · **Esfuerzo:** 3 · **Prioridad:** 2 · **Valor de negocio:** 60 · `HU-3` `P1` `MVP`

Criterios de aceptación:
- Reproduce todos los campos con etiqueta y valor en el orden dado.
- Incluye línea de firma del representante legal y marca de campos obligatorios.

#### ✅ Preparar valores para portales web (formato no soportado)

Como analista, cuando el cliente pide registro en un portal web, quiero los valores listos para copiar, para no transcribirlos a mano.

**Estado:** Done · **Esfuerzo:** 2 · **Prioridad:** 3 · **Valor de negocio:** 30 · `HU-3` `P2` `MVP`

Criterios de aceptación:
- El agente responde 'formato no soportado'.
- Se genera valores-portal.md con campo, valor y estado.
- Credenciales y envío quedan explícitamente en manos de una persona.

### F1.3 · Paquete para firma y cierre humano

#### ✅ Armar el paquete para firma con checklist y borrador de correo

Como analista, quiero un paquete con formulario, soportes, checklist y borrador de correo, para enviarlo a firma en un solo paso.

**Estado:** Done · **Esfuerzo:** 5 · **Prioridad:** 1 · **Valor de negocio:** 90 · `HU-4` `MVP`

Criterios de aceptación:
- Copia los soportes exigidos que existan y estén vigentes.
- Un soporte vencido o ausente bloquea listo_para_firma; un campo faltante no lo bloquea pero aparece en el checklist.
- El borrador de correo nunca incluye datos bancarios.

#### ✅ Exigir confirmación humana explícita antes del envío

Como responsable del proceso, quiero que ninguna acción externa ocurra sin una confirmación explícita, para que la decisión final siempre sea humana.

**Estado:** Done · **Esfuerzo:** 3 · **Prioridad:** 1 · **Valor de negocio:** 100 · `RN4` `CA3` `MVP`

Criterios de aceptación:
- El agente termina el turno con una pregunta de confirmación y la interfaz la resalta.
- El servidor solo habilita el envío si el mensaje inmediatamente anterior es una afirmación explícita a esa pregunta.
- Sin confirmación, la herramienta responde 'requiere confirmación explícita' aunque el modelo lo intente.

#### ✅ Manejar errores de forma clara sin interrumpir la sesión

Como analista, quiero que el agente falle de forma clara, para no perder tiempo depurando.

**Estado:** Done · **Esfuerzo:** 3 · **Prioridad:** 2 · **Valor de negocio:** 60 · `HU-5` `MVP`

Criterios de aceptación:
- Ninguna herramienta lanza excepciones: todas devuelven { ok, data } o { ok: false, error }.
- Errores del modelo (timeout, cupo, saturación) se muestran en lenguaje claro y la sesión sigue viva.

### F1.4 · Plataforma, experiencia y despliegue

#### ✅ Chat web con bandeja de solicitudes y expediente del caso

Como analista, quiero ver las solicitudes, el avance y los pendientes de cada caso en una sola pantalla, para decidir rápido qué falta.

**Estado:** Done · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 70 · `UX` `MVP`

Criterios de aceptación:
- Muestra cada llamada a herramienta con su detalle técnico.
- El expediente muestra estado de firma, avance, pendientes y archivos descargables.
- Funciona en celular y en modo oscuro.

#### ✅ CI/CD: verificación automática y despliegue en Azure Container Apps

Como equipo, quiero que cada cambio se verifique antes de publicarse, para no romper el agente en producción.

**Estado:** Done · **Esfuerzo:** 3 · **Prioridad:** 2 · **Valor de negocio:** 50 · `DevOps` `MVP`

Criterios de aceptación:
- Cada push ejecuta typecheck, demo.ts sin modelo y verificación del módulo.
- La imagen se publica en GHCR y Azure Container Apps la ejecuta con la clave como secreto.

#### ✅ Resiliencia ante límites y saturación del proveedor de LLM

Como responsable del servicio, quiero que el agente siga respondiendo cuando un modelo se satura o agota su cupo, para no depender de un solo modelo.

**Estado:** Done · **Esfuerzo:** 3 · **Prioridad:** 1 · **Valor de negocio:** 70 · `LLM` `MVP`

Criterios de aceptación:
- Ante 429, 503 o lentitud, el adaptador pasa al siguiente modelo de la lista y recuerda hasta cuándo evitar el agotado.
- El modelo se cambia por variable de entorno, sin tocar código.

#### ✅ Empaquetar el agente como módulo reutilizable

Como plataforma de agentes, quiero importar el agente sin depender del servidor, para reutilizarlo en otros canales.

**Estado:** Done · **Esfuerzo:** 2 · **Prioridad:** 3 · **Valor de negocio:** 40 · `Bonus` `MVP`

Criterios de aceptación:
- modulo/ contiene agent.md, las herramientas y el skill de conocimiento.
- Se genera desde las mismas fuentes que la aplicación y CI verifica que no diverjan.

## E2 · Canales conversacionales

_In Progress._ Llevar el mismo agente a los canales donde ya trabaja el equipo, reutilizando el ciclo del agente sin duplicar lógica.

### F2.1 · Canal Telegram

#### ✅ Atender solicitudes por Telegram con confirmación por botones

Como analista, quiero pedirle al agente desde Telegram que procese un caso y confirmar el envío con un botón, para trabajar desde el celular.

**Estado:** Done · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 50 · `Canal` `Telegram`

Criterios de aceptación:
- Cada chat de Telegram es una sesión del mismo agente.
- La pregunta de confirmación se muestra con botones Sí, confirmo / Todavía no.
- El bot envía el formulario y el checklist generados como archivos.
- Solo responde a usuarios autorizados (lista blanca) y valida el token secreto del webhook.

### F2.2 · Canal Microsoft Teams

#### ⬜ Publicar el agente en Microsoft Teams con inicio de sesión único

Como analista, quiero usar el agente dentro de Teams sin volver a autenticarme, para no cambiar de herramienta.

**Estado:** New · **Esfuerzo:** 8 · **Prioridad:** 3 · **Valor de negocio:** 60 · `Canal` `Teams`

Criterios de aceptación:
- Bot con Azure Bot Service (CloudAdapter, SingleTenant).
- Identifica al usuario con SSO de Entra ID.
- Aprobación de la app por el administrador de Teams.

## E3 · Integración con sistemas reales

_New._ Reemplazar las simulaciones del MVP por las integraciones reales de producción.

### F3.1 · Recepción y archivo

#### ⬜ Leer solicitudes desde el buzón real con Microsoft Graph

Como analista, quiero que las solicitudes que llegan al buzón aparezcan solas en la bandeja, para no depender de que alguien las deposite.

**Estado:** New · **Esfuerzo:** 8 · **Prioridad:** 1 · **Valor de negocio:** 90 · `Integración` `Graph`

Criterios de aceptación:
- Detecta correos de solicitud de registro y extrae remitente, país y adjuntos.
- Los datos del correo llegan al modelo solo como campos estructurados (mitiga prompt injection).

#### ⬜ Leer las plantillas reales del cliente (Excel y PDF binarios)

Como analista, quiero que el agente llene el archivo original del cliente, para devolverlo en su mismo formato.

**Estado:** New · **Esfuerzo:** 8 · **Prioridad:** 1 · **Valor de negocio:** 80 · `Integración` `Documentos`

Criterios de aceptación:
- Detecta etiquetas y celdas en el Excel del cliente.
- Rellena AcroForms de PDF cuando existan.

#### ⬜ Archivar el paquete en SharePoint

Como área administrativa, quiero cada paquete archivado por cliente y fecha, para tener trazabilidad del registro.

**Estado:** New · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 50 · `Integración` `SharePoint`

Criterios de aceptación:
- Estructura de carpetas por cliente/año.
- Enlace al paquete en el checklist.

#### ⬜ Enviar a firma electrónica del representante legal

Como representante legal, quiero recibir el paquete listo para firmar electrónicamente, para cerrar el registro el mismo día.

**Estado:** New · **Esfuerzo:** 8 · **Prioridad:** 2 · **Valor de negocio:** 70 · `Integración` `Firma`

Criterios de aceptación:
- Solo se envía un paquete listo para firma y confirmado por la analista.
- El estado de la firma vuelve al expediente.

### F3.2 · Portales web asistidos

#### ⬜ Llenado asistido de portales web con navegador controlado

Como analista, quiero que el agente llene el portal del cliente mientras yo observo, para evitar transcribir campo por campo.

**Estado:** New · **Esfuerzo:** 13 · **Prioridad:** 3 · **Valor de negocio:** 60 · `Portal` `Playwright`

Criterios de aceptación:
- La persona ingresa credenciales, resuelve CAPTCHA o MFA y hace clic en Enviar.
- Selectores por etiqueta visible; si un campo no se encuentra, el agente se detiene y reporta.
- Captura de pantalla antes del envío dentro del paquete.

## E4 · Operación, seguridad y gobierno del dato

_New._ Condiciones para operar el agente en producción de forma segura, medible y sostenible.

### F4.1 · Seguridad y plataforma

#### ⬜ Autenticación con Entra ID y roles

Como responsable de seguridad, quiero que solo el personal autorizado use el agente, para proteger datos sensibles.

**Estado:** New · **Esfuerzo:** 5 · **Prioridad:** 1 · **Valor de negocio:** 80 · `Seguridad`

Criterios de aceptación:
- SSO con Entra ID.
- Roles analista y supervisor.
- Auditoría de quién confirmó cada envío.

#### ⬜ Modelo de lenguaje con datos dentro del tenant

Como responsable de datos, quiero que los datos bancarios y personales no salgan a un plan gratuito, para cumplir la política de privacidad.

**Estado:** New · **Esfuerzo:** 3 · **Prioridad:** 1 · **Valor de negocio:** 90 · `Seguridad` `LLM`

Criterios de aceptación:
- Plan de pago sin uso de datos para entrenamiento o Azure OpenAI en el tenant.
- Opción de enmascarar valores bancarios hacia el modelo.

#### ⬜ Persistir sesiones y archivos en Azure Storage

Como responsable del servicio, quiero que sesiones y paquetes sobrevivan a reinicios, para no perder trabajo.

**Estado:** New · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 60 · `Plataforma`

Criterios de aceptación:
- Paquetes en Blob Storage con política de ciclo de vida.
- Sesiones en Table Storage.
- Permite escalar a más de una réplica.

### F4.2 · Gobierno del dato y medición

#### ⬜ Alertas proactivas de vencimiento de soportes

Como analista, quiero saber antes de que venza un soporte, para que un registro no se bloquee el día que llega la solicitud.

**Estado:** New · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 70 · `Gobierno del dato`

Criterios de aceptación:
- Aviso 10 días antes del vencimiento (la Cámara de Comercio vence cada 30 días).
- Lista de soportes por renovar en la bandeja.

#### ⬜ Dueño y frescura del repositorio maestro

Como responsable del dato, quiero saber cuándo se actualizó cada dato del maestro, para no enviar información desactualizada.

**Estado:** New · **Esfuerzo:** 3 · **Prioridad:** 2 · **Valor de negocio:** 60 · `Gobierno del dato`

Criterios de aceptación:
- Fecha de última actualización por campo.
- Alerta si un dato crítico (NIT, cuenta, representante legal) supera la antigüedad definida.

#### ⬜ Métricas de negocio y observabilidad

Como Product Manager, quiero medir el impacto del agente, para decidir si escalarlo a otros procesos.

**Estado:** New · **Esfuerzo:** 5 · **Prioridad:** 2 · **Valor de negocio:** 70 · `Métricas`

Criterios de aceptación:
- Tiempo por registro (antes vs. después).
- Porcentaje de campos llenados automáticamente.
- Tasa de paquetes bloqueados y su causa.
- Trazas y errores en Application Insights.
