# Flujos de negocio — SaaS multiempresa

> Diseño de los procesos conectados, con foco en **presupuesto → cuenta por cobrar → factura →
> pago** y el **flujo inverso** (cobro antes de factura). Separa siempre **comercial**,
> **facturación** y **movimiento real de dinero**. Complementa
> [`MODELO_DATOS.md`](MODELO_DATOS.md).

## 0. Principio rector

Cuatro conceptos **independientes**, nunca mezclados:

1. **Lo que tengo que cobrar** → `ps_obligations(kind=receivable, status OPEN/PARTIAL)`.
2. **Lo que cobré** → `ps_payments` + `ps_cash_movements(direction=in)`.
3. **Lo que tengo que pagar** → `ps_obligations(kind=payable)`.
4. **Lo que pagué** → `ps_payments` + `ps_cash_movements(direction=out)`.

Reglas duras:
- Una **factura emitida no implica cobro**; un **cobro no implica factura**.
- **Aceptar un presupuesto no genera dinero cobrado**, sólo una obligación.
- **Nunca** se cuenta como ingreso real una mensualidad futura o una factura pendiente.
- **No** se crean ingresos duplicados cuando se factura y se cobra la misma operación.

Cada obligación muestra **dos estados en paralelo**:

| Estado de cobro | Estado de facturación |
|---|---|
| Pendiente / Parcial / Cobrado / Vencido* | No facturado / Facturado / Anulado |

\* *Vencido* es **derivado** de saldo pendiente + `due_on < hoy` (no es un estado almacenado).

Combinaciones válidas: `No facturado/Pendiente`, `Facturado/Pendiente`, `Facturado/Parcial`,
`Facturado/Cobrado`, `No facturado/Cobrado`.

---

## 1. Comercial → compromiso de cobro

```
Oportunidad (CRM)
   └─ ganada (acción explícita)
        ├─► Presupuesto (comercial o técnico)
        │      └─ ACCEPTED ──► Obligación de cobro (receivable)   [No facturado / Pendiente]
        └─► Proyecto (opcional, explícito)  ──► Tareas
```

- La oportunidad pasa de etapa **sin duplicar datos** (mismo registro, cambia `stage_id`).
- Al **ganar**, el usuario decide explícitamente crear proyecto y/o convertir presupuesto en
  obligación. No hay duplicación automática indiscriminada.
- El presupuesto aceptado queda vinculado a `client_id` y `opportunity_id`; genera **una**
  obligación (one-off) o configura un **servicio recurrente** (abono).

---

## 2. Flujo 1 — primero facturo, después cobro

```
Obligación [No facturado / Pendiente]
   │  emitir factura (AFIP)
   ▼
[Facturado / Pendiente]  ── WhatsApp de cobranza ──►  (cliente paga)
   │  registrar cobro
   ▼
[Facturado / Cobrado]   (o [Facturado / Parcial] si es pago parcial)
```

1. Existe la obligación (o mensualidad del período).
2. El usuario **emite la factura** → `ps_invoices` (CAE), `billing_status=ISSUED`. La obligación
   no cambia su estado de cobro.
3. Opcional: **enviar comprobante + solicitud de pago por WhatsApp** (previsualizar → editar → abrir
   `wa.me`).
4. Al recibir el dinero, **registrar cobro** → `ps_payments` (+ `ps_cash_movements in`).
5. El estado de cobro pasa a Cobrado o Parcial según el saldo.

---

## 3. Flujo 2 — primero cobro, después facturo

```
Obligación [No facturado / Pendiente]
   │  registrar cobro
   ▼
[No facturado / Cobrado]  ──► actualiza caja (ps_cash_movements in)
   │  emitir factura después (dentro de plazos/condiciones fiscales)
   ▼
[Facturado / Cobrado]   (cobro y comprobante quedan relacionados)
```

1. Existe la obligación.
2. El usuario **registra el dinero recibido** → `ps_payments` + `ps_cash_movements`.
3. Se actualiza el saldo financiero; la obligación figura **cobrada pero pendiente de facturación**.
4. El usuario **emite la factura** luego; `ps_invoices.obligation_id` la vincula al mismo compromiso.
5. **No** se crea un ingreso nuevo: factura y cobro refieren a la misma obligación.

> La obligación fiscal de emitir no depende sólo de cuándo el operador decide facturar; el sistema
> contempla las reglas vigentes aplicables (ver [`ROADMAP.md`](ROADMAP.md), facturación por perfil
> fiscal). No se emiten comprobantes reales en pruebas.

---

## 4. Mensualidades (abonos) idempotentes

```
ps_recurring_services (cliente, concepto, importe, moneda, frecuencia, inicio, fin?, política)
   └─ generatePeriod(service, 'YYYY-MM')  ── upsert ──►  ps_obligations (service, period)
                                                            (unique: nunca duplica)
```

- Cada período materializa **una** obligación la primera vez que se ve/cobra el mes.
- Vista: `Cliente | Servicio | <Mes> | Facturado | Cobrado | Pendiente | Acciones`.
- **Pausar / finalizar / modificar** ajusta `active`/`end_period`/`amount` **sin destruir** meses
  anteriores (los históricos permanecen con su tasa congelada).
- Cada cobro de mensualidad **congela** la cotización del momento (igual que hoy
  `recurringChargeLog`).

---

## 5. Registro rápido de cobro

Al presionar **"Registrar cobro"** se solicita: importe (precargado con el **saldo pendiente**),
fecha real, medio de pago, cuenta de destino, referencia opcional, observación opcional.

- Permite **parciales**, **múltiples**, **anticipados** y, cuando corresponde, **aplicar un pago a
  varias obligaciones**.
- Conserva la **fecha real** de cada pago y, en multimoneda, **cotización histórica + moneda
  original** (`ps_payments.exchange_rate` inmutable).
- Genera el `ps_cash_movements(in)` asociado y actualiza saldos.

---

## 6. WhatsApp de cobranza

```
Plantilla de la empresa + variables ─► Previsualizar ─► Editar ─► Abrir wa.me (texto preparado)
```

Variables: `{nombre_cliente}`, `{concepto}`, `{período}`, `{importe_pendiente}`, `{moneda}`,
`{vencimiento}`, `{alias/datos_bancarios}`, `{empresa}`.

- Nunca envía automáticamente ni marca como "enviado" algo no verificable.
- La plantilla es configurable por empresa (reutiliza `paymentMessageTemplate` actual, ampliado).

---

## 7. Cuentas por pagar (misma filosofía)

- Registrar obligación (proveedor/concepto/vencimiento), pagos parciales, pendientes y vencidos,
  pagos recurrentes, adjuntar comprobantes.
- Diferencia **fecha de obligación** (`due_on`) de **fecha efectiva de salida** (`paid_on` del pago /
  `occurred_on` del movimiento).

---

## 8. Movimientos de caja y conciliación

Vista cronológica: `Fecha | Concepto | Cliente/Proveedor | Cuenta | Ingreso | Egreso | Saldo`.

- **Múltiples cuentas** (banco/efectivo/MP/cripto), cada una con `opening_balance`.
- **Transferencias internas**: dos movimientos con el mismo `transfer_group_id` y
  `is_internal_transfer=true`. **Excluidas** de ingresos/egresos (P&L y flujo de caja); **incluidas**
  en el saldo de cada cuenta. No hay doble conteo.
- **Reversiones con trazabilidad** (pago reversor, nunca `update` del original).
- **Conciliación**: la caja cuadra con cobros, pagos y transferencias registrados.

---

## 9. Arrastres (carry-overs) y preservación de la lógica actual

- Los **ingresos con saldo parcial** de meses anteriores se "arrastran" y muestran en meses
  siguientes **sólo en vista Mes**, hasta cobrarse al 100% (igual que `getCarryOversForMonth`).
  Nunca se suman en Año/Rango (duplicaría).
- Se preservan: pagos históricos, pagos parciales, cotizaciones congeladas, mensualidades
  anteriores, gastos recurrentes, arrastres, facturas existentes y totales financieros.
- **Antes** de mover el motor a tablas relacionales se agregan **tests de caracterización** que
  congelan los resultados actuales; el motor normalizado debe reproducirlos (ARS y USD, a < $0,01).

---

## 10. Resumen financiero (qué muestra y qué no)

Muestra sólo indicadores para decidir: saldo de caja, total pendiente de cobrar, total vencido,
total pendiente de pagar, **cobrado** del mes, **pagado** del mes, resultado de caja del período,
con saldo inicial / movimientos / saldo final explícitos. Filtra por fecha, moneda y cuenta.

**No** suma como ingreso real: mensualidades futuras ni facturas pendientes. El resultado de caja
es **base caja** (cada pago a su tasa congelada), no devengado.
