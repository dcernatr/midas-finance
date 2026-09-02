# MIDAS Finance

MIDAS (Money Intelligence, Debt, Allocation & Spending) es un hub de control de gastos construido con Next.js y Appwrite Cloud.

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

## Stack

- Next.js 16 + React 19 + TypeScript
- Appwrite Auth + TablesDB
- Tailwind CSS + componentes shadcn
- Appwrite Sites

## Desarrollo local

1. Crea un proyecto exclusivo para MIDAS en Appwrite Cloud y elige la region **New York (`nyc`)** para reducir la latencia desde Peru frente a Europa.
2. Copia `.env.example` a `.env.local` y completa:

   - `NEXT_PUBLIC_APPWRITE_ENDPOINT`
   - `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
   - `APPWRITE_API_KEY`
   - `APPWRITE_DATABASE_ID=midas`

3. Crea una API key de servidor con estos scopes:

   - `sessions.write`
   - `databases.read`, `databases.write`
   - `tables.read`, `tables.write`
   - `columns.read`, `columns.write`
   - `indexes.read`, `indexes.write`
   - `rows.read`, `rows.write`

4. Instala, prepara Appwrite y ejecuta:

   ```bash
   npm install
   npm run appwrite:setup
   npm run dev
   ```

5. Abre `http://localhost:3000`.

## Base de datos

`scripts/setup-appwrite.mjs` crea una base independiente y diez tablas privadas `midas_*`, incluida la secuencia de códigos. El navegador no recibe la API key ni accede directamente a las tablas. Las rutas Next.js validan la sesión y fuerzan el `user_id` en cada operación. El primer usuario registrado recibe el rol ADMIN.

### Actualización de una instalación existente (antes de desplegar)

El sitio Appwrite ya vinculado a MIDAS ejecuta esta migración automáticamente mediante `prebuild`, utilizando la credencial de servidor que ya tiene configurada. Se verifica el sitio, proyecto, región y base de datos antes de acceder a los datos. Si la configuración o la migración falla, se detiene la compilación. Las compilaciones locales/CI sin `APPWRITE_SITE_ID` no modifican ninguna base. No es necesario copiar ni revelar credenciales.

Referencia de las variables inyectadas por el proveedor: https://appwrite.io/docs/products/sites/environment-variables

Con las variables de servidor ya configuradas para **el proyecto MIDAS**, ejecuta:

```bash
npm run appwrite:migrate-ledger
```

La migración es aditiva e idempotente: agrega `midas_transactions.midas_code` y `midas_transaction_sequences`, sin borrar movimientos ni modificar otros proyectos. Requiere los permisos de tablas, columnas e índices indicados arriba. **No desplegar esta versión antes de que termine correctamente.** Al cargar los datos después del despliegue, los movimientos anteriores sin código reciben uno; los que ya lo tienen lo conservan.

La numeración es independiente por usuario, año-mes y tipo (G/I), compartida entre registros manuales e importados. El incremento y la escritura se confirman en una transacción de Appwrite. Los números eliminados no se reutilizan. Cambiar el mes o tipo de un movimiento asigna un código del nuevo período/tipo. Más de 999 movimientos continúa en 1000, sin truncarse.

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
- El panel inicial distingue **todavía no cargado** de **guardado en tu cuenta**. Muestra las nueve categorías y S/ 13,530 para septiembre 2026, con inicio 28/08/2026. Solo se aplica al guardar en la cuenta conectada: disponer de la plantilla o publicar código no equivale a cargar los datos. Es idempotente, reutiliza nombres equivalentes y conserva colores e importes existentes. Los conflictos de fecha, categoría archivada o importe distinto se muestran antes del guardado y se rechazan también en servidor. Las categorías adicionales se conservan y se suman al total, sin impedir agregar las faltantes. No crea deudas, pagos ni movimientos. Quitar una categoría del plan solo la retira del periodo seleccionado.

### Categorías pendientes y equivalencias

- Una categoría importada no es una categoría programada por el solo hecho de existir en el catálogo. Debe pertenecer al presupuesto del periodo del gasto, incluso cuando el presupuesto asignado sea cero.
- Los gastos desconocidos permanecen visibles y cuentan en los totales; aparecen pendientes. En la vista previa y en la tabla, el desplegable ofrece categorías programadas, “Agregar actual” y “Agregar nueva”. Crear o presupuestar requiere confirmar nombre, monto y color. El importe observado se ofrece como referencia, no se convierte automáticamente en presupuesto.
- Se puede vincular un movimiento o guardar una equivalencia para los pendientes del mismo archivo/pestaña/categoría y futuras importaciones. Se ignoran mayúsculas, tildes y espacios extra al comparar nombres. Las equivalencias solo se resuelven cuando el destino está programado en el periodo correspondiente; no crean presupuesto en otros periodos.
- La categoría original se conserva separada de la asignada. La identidad de deduplicación no se modifica al vincular ni al renombrar una categoría en MIDAS. Las asignaciones individuales prevalecen sobre equivalencias de grupo. Las importaciones anteriores sin categoría original conservada usan su categoría conocida como referencia; los registros sin ámbito inequívoco de pestaña solo admiten vinculación individual.

La migración aditiva `scripts/budget-schema.mjs` crea `midas_budget_profiles` sin permisos públicos y dos columnas opcionales de trazabilidad en movimientos. Se ejecuta junto con la migración de códigos en el destino MIDAS validado; **no aplica presupuestos personales durante la compilación**. Las pruebas locales no acceden a bases reales.

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
npm run appwrite:setup
npm run appwrite:migrate-ledger
```

## Despliegue en Appwrite Sites

En Appwrite, abre **Sites → Create site → Connect Git repository**, selecciona este repositorio y usa:

- Framework: Next.js
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: `.next`

Agrega las cuatro variables de `.env.example`. Appwrite Sites soporta Next.js SSR directamente.
