# Solución — agente de órdenes de compra

## 1. Problema en una frase

La analista administrativa digita a mano, por cada factura, una orden de compra que ya llegó completa por correo, y un centro de costos o un aprobador mal contrastados se corrigen tarde.

Le duele a ella el tiempo y el error de digitación, a contabilidad el cierre, y a la dirección no saber cuántas órdenes nacen después de la factura.

## 2. Arquitectura

```
Chat (web/)  --HTTP-->  API (src/server.ts)
                              |
                         ciclo (src/agent/loop.ts)
                              |
                    adaptador LLM (src/llm/)     herramientas (src/tools/oc.ts)
                                                         |
                                              dominio RC1–RC10 (src/domain/)
                                                         |
                                    fixtures/ (lectura)     out/ (escritura)
                                                         |
                                              SAP simulado (src/sap/mock.ts)
```

- El comportamiento del agente está en `agent/prompt.md`.
- El conocimiento del proceso está en `src/knowledge/ordenes-compra.md`. El ciclo los carga al armar el mensaje de sistema; cambiar una regla de redacción no toca el servidor.
- La ejecución está en `src/tools/oc.ts` y en `src/domain/`. El modelo no calcula montos ni números de orden.
- `modulo/tools/oc.ts` reexporta las mismas herramientas. `modulo/agent.md` y `modulo/skill/ordenes-compra/SKILL.md` se generan desde esas dos fuentes. `demo.ts` falla si el hash diverge y no los sobrescribe.

## 3. Ciclo del agente

Cada turno agrega el mensaje de la analista a la sesión (`out/sessions/<id>.json`) y llama al adaptador con el historial y las herramientas. Si el modelo pide herramientas, el servidor valida los argumentos con zod, ejecuta y devuelve el JSON al modelo. El tope es `MAX_TOOL_ITERATIONS` (25). Al llegar, el turno cierra con lo ya obtenido y dice que falta cerrar el caso.

La confirmación no depende de que el modelo se porte bien. Si hay confirmaciones, `oc_crear` solo crea cuando `confirmado` es true, la sesión ya quedó esperando ese caso en un turno anterior y el mensaje actual es afirmativo (`confirmo`, `sí`, `procede`, …). En `demo.ts` la confirmación explícita del harness sí vale, porque no hay un turno de chat. El API marca `needsConfirmation` y el chat lo resalta.

Cada llamada queda en el historial visible y en `out/log.jsonl`. Un error del modelo o de una herramienta se muestra en el chat; la sesión no se descarta. `MAX_SESSION_TOKENS` (80000) corta una sesión que se alarga, y el proveedor tiene timeout (`LLM_TIMEOUT_MS`, 60 s).

## 4. Elección del modelo

Proveedor Gemini, modelo `gemini-3.8-flash`, temperatura 0 y `reasoning_effort` bajo, detrás de `LlmAdapter`. Se eligió porque el cupo gratuito de Google AI Studio cubre este modelo y sigue el uso de herramientas. La llamada va al extremo compatible con chat completions (`generativelanguage.googleapis.com/v1beta/openai/chat/completions`), así el historial de herramientas no cambia de forma. La clave vive en `GEMINI_API_KEY` y el adaptador la redacta si un error del proveedor la devolviera. Un 429 se informa como cupo agotado y la sesión sigue activa.

Cambiar de proveedor es otro archivo en `src/llm/` que cumpla `enviar(mensajes, herramientas)`. El ciclo no conoce a Gemini.

## 5. Matriz de controles

| Regla | Implementación | Tipo |
|---|---|---|
| RC1 | NIT normalizado a 9 dígitos; si no hay NIT, nombre sin tildes ni puntuación. Debe existir y estar activo. | Bloqueo |
| RC2 | Hay aprobación, el cuerpo contiene "Aprobado" y el correo está en los aprobadores de ese centro. | Bloqueo |
| RC3 | El valor se compara con el tope de esa persona, no con el de otro líder del centro. | Bloqueo |
| RC4 | La subárea está en la lista del centro. | Bloqueo |
| RC5 | Sin cotización, o si la diferencia absoluta de totales supera el 2 %. El mensaje lleva los dos valores. | Confirmación |
| RC6 | Sin IVA se propone el indicador por defecto del proveedor y se pide confirmación. | Confirmación y derivado |
| RC7 | Sin condiciones de pago se usa la del proveedor y solo se informa. | Derivado |
| RC8 | Factura con fecha anterior a la solicitud: `retroactiva` y confirmación. | Confirmación |
| RC9 | Fecha de aprobación (solo el día, sin convertir zona) anterior a la solicitud. | Confirmación |
| RC10 | `cantidad × valor_unitario` fuera de 1 unidad monetaria del total. | Bloqueo |

`apta` es verdadero solo si no hay bloqueos. `oc_crear` relee el caso y vuelve a validar; el payload que manda el modelo no es la fuente de los montos.

La más difícil fue RC5 junto con la lectura de la cotización. El total del texto está en pesos con punto de miles e IVA incluido, igual que `valor_total` de la solicitud. Comparar base gravable contra total habría marcado diferencias falsas en casos que de hecho cuadran (`sol-001`).

Resultado de los fixtures: `sol-001` crea `4500000001`; `sol-002` bloquea por RC1; `sol-003` bloquea por RC2; `sol-004` pide RC5 (25 000 000 contra 26 500 000); `sol-005` pide RC8 y queda retroactiva; `sol-006` pide RC6 (IVA `C1`) e informa RC7 (`Z030`).

## 6. Diseño del adaptador SAP real

Elegiría OData `API_PURCHASEORDER_PROCESS_SRV`, llamado desde un destino en SAP BTP o Integration Suite, no desde el proceso del agente. La viabilidad de la red hacia SAP no está confirmada: HTTP se puede sustituir por el mock o por un archivo de carga sin reescribir el ciclo. RFC/`BAPI_PO_CREATE1` ata el runtime a la librería del conector y a la red del application server; lo dejaría como segunda opción si OData no cubre la imputación a centro de costo que use la compañía.

Mapeo del payload de este reto:

- Cabecera: `CompanyCode` 1000, `PurchasingOrganization` 1000, `Supplier` = `proveedor.codigo_sap`, `DocumentCurrency`, `PaymentTerms` = `condiciones_pago`.
- Posición 10: texto breve (40), `OrderQuantity`, unidad, `NetPriceAmount`, `TaxCode` = indicador de IVA.
- Imputación: centro de costo y, si el modelo de datos lo tiene, la subárea como clasificación adicional.
- Referencia externa: `solicitud_id` en un campo de referencia o extensión (`YY1_SolicitudId`) para poder buscarla antes de crear.
- Adjunto: el PDF de evidencia por la API de attachments, no dentro del prompt.

Autenticación: OAuth de cliente o propagación vía Destination service. Las credenciales viven en el destino o en el almacén del runtime de integración, nunca en el repositorio, el prompt ni el navegador.

Idempotencia: antes de cada `POST`, `GET` filtrando por `solicitud_id`. Si la orden ya existe, se devuelve su número. Si SAP responde un error parcial (cabecera creada e imputación rechazada), no se reintenta el alta: se consulta el documento y se muestra el error a la analista para que decida.

Plan B: el mismo payload se escribe como archivo de carga (Migration Cockpit o plantilla de carga masiva) más el PDF. La analista deja de digitar aunque SAP no esté conectado. El log de control sigue midiendo las retroactivas.

## 7. Lectura del proceso para la dirección

`sol-005` es el patrón que la dirección quiere medir: la factura es del 10 de agosto y la solicitud del 27. La orden no autoriza la compra; se fabrica para poder radicar un gasto que ya ocurrió. La cotización, cuando existe, llega tarde para negociar.

No rechazaría todavía esas órdenes. Nadie ha fijado la política, y cortarlas de un día para otro deja facturas sin documento. Sí las dejaría marcadas, como hace el agente en `out/control.csv`, y miraría cada semana qué porcentaje del total es retroactivo y en qué centros se concentra.

El cambio de proceso que propondría es el de siempre, aguas arriba: no se radica una factura sin orden previa. El agente ahorra la digitación del caso normal y hace visible el desvío; no reemplaza esa regla.

## 8. Decisiones y trade-offs

1. Las herramientas releen los fixtures en cada llamada. La alternativa era confiar en el paquete que reenvía el modelo. Se descartó porque el modelo puede alterar un monto para que la cotización cuadre, y el PRD pide que los valores salgan de las herramientas.
2. La confirmación exige un turno nuevo y una frase afirmativa de la analista. La alternativa era aceptar `confirmado: true` en cuanto el modelo lo envíe. Se descartó porque el modelo puede auto-confirmar en el mismo turno en el que descubrió la diferencia.
3. SAP real queda diseñado y el runtime usa archivos. La alternativa era intentar RFC en el reto. Se descartó porque la conexión no está confirmada y el evaluador pide el mock.
4. No hay suite de pruebas unitarias. La verificación es `demo.ts`, que el enunciado exige y que fija el resultado de los seis casos, más el recorrido del chat. Una suite aparte se descartó para no duplicar el mismo contrato.
5. No se lee `.xlsx` real. Los fixtures ya traen JSON. Sumar un lector de Excel no cambia el control y sí agrega una dependencia.

## 9. Supuestos

- El NIT de la cotización trae dígito de verificación; el maestro tiene 9 dígitos. Se descarta el último dígito si el valor es más largo.
- El total comparable es el de IVA incluido, en la solicitud y en la cotización.
- La factura no es un adjunto obligatorio. Solo `sol-005` la trae. Su ausencia no entra en `faltantes`.
- La unidad de la posición es `UN`, salvo que la descripción hable de horas (`H`).
- La descripción se corta a 40 caracteres. El texto completo queda en la trazabilidad.
- La validez de la cotización se calcula y se guarda, y no bloquea ni pide confirmación: el PRD no lo pide.
- `demo.ts` puede pasar `confirmado: true` sin un turno de chat previo. El chat no puede.
- Los maestros de los fixtures están completos. En producción se consultarían en SAP.

## 10. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Lector de Excel y PDF binarios, y el buzón real. |
| HU-2 Validar RC1–RC10 | Hecho | Maestros en vivo y la política definitiva de retroactivas. |
| HU-3 Payload y trazabilidad | Hecho | Mapeo ejecutado contra el OData real, no solo diseñado. |
| HU-4 Evidencia | Hecho (txt y PDF) | Custodia del PDF y, si auditoría lo pide, firma digital. |
| HU-5 Crear en SAP simulado | Hecho | El adaptador real, la idempotencia contra SAP y el error parcial. |
| HU-6 Errores legibles | Hecho | Catálogo de errores SAP traducido a la analista. |
| Chat, ciclo, confirmación | Hecho | Identidad de la analista y un enlace público con la clave fuera del repo. |
| `oc_leer_excel` | No hecho | Es P1 opcional; los fixtures no traen xlsx. |

## 11. Uso de IA

Se construyó con Cursor, modelo Grok 4.7, a partir del PRD y de los fixtures. La IA escribió el esqueleto, las reglas y el chat. Se descartó dejar que el modelo de lenguaje calcule montos o decida si la orden es válida: eso quedó en código y `demo.ts` lo fija. También se descartó una suite de pruebas unitarias aparte, porque la verificación pedida es el demo de los seis casos.

Quien entregue esto tiene que poder explicar cada archivo: el dominio valida, las herramientas no lanzan excepciones, el adaptador es el único que ve la clave y el mock asigna el número desde `4500000001`.

## 12. Riesgos de llevarlo a producción

- El modelo puede explicar mal un bloqueo aunque no pueda crear la orden. Mitigación: el texto del hallazgo sale de la herramienta y `oc_crear` vuelve a validar.
- Una confirmación afirmativa demasiado amplia (`ok`, `sí`) crea la orden. Mitigación aceptada en el reto; en producción pediría un botón explícito y un perfil de la analista.
- Los maestros copiados se desactualizan. Mitigación: consultarlos en SAP en el momento de validar.
- La clave del modelo en el servidor de la defensa puede gastarse si el enlace es público. Mitigación: tope de iteraciones y de tokens; en producción, autenticación y cuota.
- OData puede no aceptar la subárea o el adjunto como están modelados. Mitigación: el plan B de archivo de carga y una prueba de contrato con un mandante de calidad antes de cortar la digitación.
- La evidencia en PDF no es el mensaje original firmado. Mitigación: si auditoría exige el `.eml` o una firma, se adjunta ese archivo y el PDF queda como vista.
