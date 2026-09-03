# MIDAS Finance

MIDAS (Money Intelligence, Debt, Allocation & Spending) es un hub de control de gastos construido con Next.js, PostgreSQL en Neon y Neon Auth.

## Funciones principales

- Dashboard de ejecución mensual, forecast y MIDAS Score.
- Gastos programados con categorías, grupos, tipos, presupuestos y colores editables.
- Gastos efectivos manuales o importados desde Google Sheets.
- Importación append-only con detección por archivo, pestaña y contenido, vista previa y cinco campos de mapeo.
- Códigos automáticos `AA-MM-G/I-000` para movimientos manuales e importados.
- Gestión y proyección de deudas.
- HELP buscable y ADMIN protegido por rol.
- Aislamiento de datos por usuario desde el servidor y tablas privadas.
- Infraestructura propia, sin compartir base de datos con TERRAN ni PomoBoxing.

## Stack y publicación

- Next.js 16 + React 19 + TypeScript.
- PostgreSQL privado en Neon + Neon Auth.
- GitHub `dcernatr/midas-finance` → proyecto Vercel independiente.
- Región Vercel `iad1`, próxima al proyecto Neon en Virginia.
- No se reutilizan bases, claves ni proyectos de TERRAN o Pomoboxing.

## Estado de la transición

Esta versión prepara el cambio desde Appwrite. No importa historial, categorías, presupuestos ni contraseñas. Appwrite permanece intacto. Las categorías y presupuestos se ingresan manualmente o se obtienen de una nueva importación de Sheets.

No ejecutar los scripts históricos `appwrite:*` para esta instalación. Se conservan solamente como referencia de la versión anterior y no se invocan durante el build.

## Configuración inicial, una sola vez

1. Vincular el repositorio MIDAS al equipo DCT en Vercel, seleccionando Next.js y la rama de producción `main`. Las publicaciones posteriores las realiza la integración GitHub → Vercel; no hace falta un token de Vercel dentro de GitHub Actions.
2. Configurar exclusivamente en MIDAS:
   - `DATABASE_URL`: conexión **pooled** de la base `midas` del proyecto Neon `morning-rice-11813850`.
   - `DATABASE_URL_UNPOOLED`: conexión directa, solo para migraciones.
   - `NEON_AUTH_BASE_URL`: URL de Neon Auth indicada en `.env.example`.
   - `NEON_AUTH_COOKIE_SECRET`: secreto aleatorio de al menos 32 caracteres, estable entre despliegues del mismo entorno.
   - `MIDAS_ADMIN_EMAIL`: correo del propietario. Configurarlo antes de crear la cuenta. Solo ese correo verificado recibe ADMIN; los demás reciben USER.
3. Registrar la URL exacta de Vercel en los dominios autorizados de Neon Auth y verificar el envío de correos.
4. Separar producción y pruebas mediante ramas de Neon. Nunca conectar una vista previa pública a datos reales.
5. Después de verificar la vinculación y las variables, validar la migración en una rama de prueba. `npm run db:generate` genera SQL desde el esquema Drizzle, sin conectarse a ninguna base. `npm run db:migrate` aplica los archivos a la conexión directa configurada; **no ejecutarlo sobre otra base**.
6. Aplicar en producción únicamente la migración validada y publicar desde GitHub. Registrar y verificar el correo, ingresar y volver a conectar Google Sheets. Los gastos programados se crean manualmente.

La compilación no realiza migraciones ni carga datos. `npm test` compila y ejecuta las pruebas, incluidas pruebas SQL con PostgreSQL embebido; no usa datos externos. `npm run dev` requiere la configuración de Neon preparada.

## Seguridad y persistencia

La aplicación usa el esquema privado `midas_private`, con RLS habilitado y sin políticas de acceso público. El servidor usa una conexión privilegiada; por ello cada operación SQL impone además el propietario autenticado. Solo ADMIN puede consultar el conjunto administrativo y modificar ajustes globales. La contraseña es gestionada por Neon Auth, nunca por las tablas financieras. No añadir variables `NEXT_PUBLIC_` para secretos.

Los códigos `AA-MM-G/I-000` comparten un contador por usuario, mes calendario y tipo. Incremento y movimiento se confirman juntos en una transacción PostgreSQL. Si falla el guardado, se revierte el contador. Los códigos eliminados no se reutilizan. La deduplicación conserva archivo + pestaña + contenido y no reemplaza movimientos manuales.

## Google Sheets

MIDAS no usa Google API, OAuth ni credenciales. Acepta enlaces `/edit`, `drivesdk`, publicados o exportables. La hoja debe tener:

`Compartir → Acceso general → Cualquier persona con el enlace → Lector`

Al conectar el archivo, MIDAS detecta sus pestañas visibles y permite seleccionar cuál se importará y sincronizará.

Los únicos campos que se mapean son:

`Fecha | Nombre | Ingreso | Gasto | Categoría`

Fecha, Nombre y Categoría son obligatorios; basta con una de las columnas Ingreso o Gasto. Cada fila debe contener un único importe no nulo. Si Categoría dice **Ingreso** o **Ingresos** (sin distinguir mayúsculas ni acentos), MIDAS registra un ingreso con el valor absoluto del importe, incluso si está en Gasto. No hay selector adicional. Para las demás categorías, la columna Ingreso registra ingresos y Gasto registra gastos, independientemente del signo de este último. Se reconocen fechas `DD/MM/AA` e importes con `S/` o `S/.`.

La importación se procesa por lotes de hasta ocho filas, con progreso y un punto de continuación guardado en cada lote. Ante una interrupción temporal, MIDAS reintenta con el mismo identificador y conserva los movimientos ya guardados. Si cambia la hoja o el mapeo durante el proceso, pide reiniciar sin borrar datos. Las respuestas XML/HTML de error no se interpretan como JSON ni CSV; se muestra un mensaje legible. La configuración de fuentes y los movimientos manuales no se reenvían automáticamente.

Gastos Efectivos muestra **todo el histórico** por defecto, incluidas fechas anteriores o futuras. Al elegir un periodo concreto en la tabla se selecciona también ese periodo en Dashboard y Programados. “Ver periodo del Dashboard” permite comparar los mismos movimientos; la vista histórica advierte que incluye otros periodos. Al finalizar la sincronización se recarga la tabla sin caché, se limpian sus filtros y “Ver movimientos” abre el histórico completo. Si falla la recarga, “Actualizar vista” recupera los datos sin volver a importarlos. El contador visible distingue una tabla vacía de movimientos ocultos por filtros.

### Periodos por sueldo y presupuestos

- El periodo se identifica por `AAAA-MM` y abarca `[fecha de sueldo, siguiente fecha de sueldo)`. La fecha real confirmada prevalece; si falta, se muestra una estimación del último viernes del mes anterior, **sin presuponer feriados**. Cualquier fecha estimada puede corregirse. Otros ingresos no abren periodos: se sugieren candidatos por nombres configurables (inicialmente “sueldo” y “salario”) y siempre se requiere confirmación.
- El selector de periodo gobierna Dashboard, plan, Advisor, métricas de pagos de deuda y comparaciones. Las fechas originales y los códigos `AA-MM-G/I-NNN` conservan el mes calendario del movimiento. El CSV añade el periodo presupuestario y la categoría original. Los ingresos reales no suman el ingreso esperado del plan.
- Cada cuenta mantiene un perfil privado versionado con fechas confirmadas, presupuestos por periodo y equivalencias de categorías. Las modificaciones se serializan con transacciones optimistas. Los presupuestos globales anteriores se conservan como una instantánea de compatibilidad, sin reescribirlos; para nuevos periodos, el presupuesto no se copia sin confirmación.
- Los gastos programados se ingresan y editan manualmente desde **Categoría**, indicando nombre, monto y color. La referencia personal de septiembre fue puntual: se retiraron el botón, el aviso y el diálogo para cargarla, junto con sus instrucciones en HELP. No se ofrece como plantilla permanente ni se carga automáticamente. Retirar esos controles no modifica presupuestos, categorías, fechas ni movimientos ya guardados. Se conservan la configuración del sueldo y la copia opcional de un plan anterior propio.

### Categorías pendientes y equivalencias

- Una categoría importada no es una categoría programada por el solo hecho de existir en el catálogo. Debe pertenecer al presupuesto del periodo del gasto, incluso cuando el presupuesto asignado sea cero.
- Los gastos desconocidos permanecen visibles y cuentan en los totales; aparecen pendientes. En la vista previa y en la tabla, el desplegable ofrece categorías programadas, “Agregar actual” y “Agregar nueva”. Crear o presupuestar requiere confirmar nombre, monto y color. El importe observado se ofrece como referencia, no se convierte automáticamente en presupuesto.
- Se puede vincular un movimiento o guardar una equivalencia para los pendientes del mismo archivo/pestaña/categoría y futuras importaciones. Se ignoran mayúsculas, tildes y espacios extra al comparar nombres. Las equivalencias solo se resuelven cuando el destino está programado en el periodo correspondiente; no crean presupuesto en otros periodos.
- La categoría original se conserva separada de la asignada. La identidad de deduplicación no se modifica al vincular ni al renombrar una categoría en MIDAS. Las asignaciones individuales prevalecen sobre equivalencias de grupo. Las importaciones anteriores sin categoría original conservada usan su categoría conocida como referencia; los registros sin ámbito inequívoco de pestaña solo admiten vinculación individual.

El esquema Neon guarda perfiles y trazabilidad en registros privados. El script `scripts/budget-schema.mjs` pertenece a la versión histórica de Appwrite y no se ejecuta en Neon. **No se aplican presupuestos personales durante la compilación**. Las pruebas locales no acceden a bases reales.

### Coherencia del Dashboard y presentación del registro

- `lib/finance-metrics.ts` comparte los cálculos del periodo y la suma en centavos. El KPI Gasto real y la columna Gasto incluyen gastos y pagos de deuda, estos últimos desglosados y sin contarlos dos veces. Plan vs. Real compara gastos por categoría y muestra todos los conceptos, con desplazamiento vertical si hace falta. Los pendientes siempre cuentan; la composición también incluye pagos de deuda.
- `lib/state-order.ts` serializa guardados e invalida lecturas anteriores. Una lectura no sobrescribe escrituras pendientes. El formulario de ingreso/ahorro envía solo el campo cambiado, evitando reemplazar otro valor con una copia antigua. Se actualiza al volver a la ventana y existe actualización manual, con estados de carga/error/datos sin confirmar.
- El periodo inicial respeta las fechas de sueldo confirmadas, no solo la estimación. Las fechas de hoy se calculan en `America/Lima`.
- `components/expense-ledger.tsx` prioriza Fecha / Nombre / Ingreso / Gasto / Categoría. Código, origen y categoría original están en Detalles. La paginación de 25 filas no cambia los totales ni la exportación de toda la vista filtrada. En pantallas pequeñas las mismas filas se presentan como fichas, sin duplicar el contenido accesible.
- Pruebas de cálculo, concurrencia, persistencia simulada, permisos, importación y renderizado: `npm test`. Revisión de código: `npm run lint`.
- Para una revisión visual reproducible sin datos reales: compilar y ejecutar `node scripts/preview-ledger.mjs`, abrir `http://localhost:4186`. La muestra usa los componentes y CSS reales con datos ficticios; es una vista SSR sin operaciones de guardado ni hidratación React. No reemplaza una prueba autenticada de producción. El navegador de esta sesión bloqueó el acceso local, por lo que la revisión visual quedó pendiente.

No se solicita ni importa un ID de la hoja: MIDAS genera el código. Las conexiones antiguas con `ID_MOVIMIENTO` deben volver a mapear sus columnas antes de sincronizar.

La sincronización conserva ambos orígenes en Gastos Efectivos y en el CSV (cinco campos más código, origen y fuente). Los duplicados se comparan dentro del mismo archivo y pestaña; los registros manuales no se descartan por coincidir con una hoja. Reordenar filas no crea duplicados. Filas idénticas repetidas en una pestaña mantienen su multiplicidad. Sin un identificador externo estable, **editar el contenido de una fila en la hoja se considera un movimiento nuevo**. Cambiar el nombre de la pestaña también cambia el ámbito de la fuente. Las importaciones antiguas solo se reconocen automáticamente cuando su fuente guardada identifica inequívocamente la misma pestaña.

## Comandos

```bash
npm run dev
npm run lint
npm run build
npm test
npm run db:generate
# Solo tras validar la conexión al destino MIDAS:
npm run db:migrate
```

## Publicación segura

No fusionar esta migración mientras `main` siga publicando exclusivamente en Appwrite. Primero verificar el proyecto Vercel MIDAS, sus variables, la base vacía migrada y el acceso con correo verificado. La versión Appwrite permanece disponible como referencia y no se elimina. TERRAN y Pomoboxing no requieren ningún cambio.
