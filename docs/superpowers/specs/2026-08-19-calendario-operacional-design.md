# Calendario operacional personalizado e integrado con Google Calendar

Estado: Aprobado para planificación
Fecha: 2026-08-19
Fuente original: `Caso_de_Uso_Calendario_Personalizado_Google_Calendar.docx` (raíz del proyecto)

## 1. Contexto y objetivo

El cliente necesita centralizar en una única vista de calendario las actividades
provenientes de tres fuentes: una bitácora operativa interna, registros
manuales, y su Google Calendar personal. El sistema debe evitar topes de
horario entre estas fuentes y mantener la disponibilidad pública sincronizada
con Google Calendar.

Es un sistema **single-tenant**: un único administrador (el cliente), dueño de
una única cuenta de Google y un único calendario configurado. No se requiere
modelar múltiples organizaciones ni aislar datos entre tenants.

## 2. Alcance de esta primera versión

Incluye:
- Panel privado del administrador con vista de calendario, registro manual de
  actividades, módulo de Bitácora, y configuración (horario laboral, política
  de conflictos, conexión Google).
- Sincronización bidireccional con Google Calendar (crear/editar/eliminar
  desde nuestra app hacia Google, y detección de cambios hechos directamente
  en Google mediante polling periódico).
- Portal público de agendamiento sin login, con gestión de reserva propia vía
  link único enviado por email.
- Recordatorios por correo (1 día, 30 min, 5 min antes) delegados 100% en los
  recordatorios nativos de Google Calendar.

Explícitamente fuera de alcance:
- Multi-tenant (múltiples administradores/calendarios).
- Envío de recordatorios propios fuera de Google (no hay servicio de scheduler
  de emails de recordatorio).
- Autenticación con cuenta de usuario para el público (se usa link con token,
  no usuario/contraseña).
- Integración real con un sistema de Bitácora externo (se construye como
  módulo interno; el modelo de datos deja `source=bitacora` listo por si en
  el futuro se conecta un sistema externo).

## 3. Arquitectura general

- **Framework**: Next.js 15 (App Router) + TypeScript, proyecto único que
  sirve panel privado, portal público y API (Server Actions / Route
  Handlers).
- **Base de datos**: PostgreSQL (Neon), acceso vía Drizzle ORM.
- **Autenticación admin**: Auth.js (NextAuth v5) con proveedor Google OAuth.
  El mismo flujo de login pide los scopes de Google Calendar
  (`calendar.events`, `calendar.readonly`) necesarios para la integración —
  no hay un paso de "conectar Google" separado del login.
- **Integración Google Calendar**: SDK oficial `googleapis`, invocado desde
  Server Actions/Route Handlers usando el `refresh_token` del administrador
  guardado cifrado en base de datos.
- **Sincronización entrante**: cron job (Vercel Cron, cada 5 minutos) que
  usa `syncToken` incremental de la Google Calendar API (`events.list`) para
  detectar altas, cambios y eliminaciones hechas directamente en Google.
- **Emails**: Resend, usado únicamente para el correo con el link de gestión
  de una reserva pública (no para recordatorios, que van por Google nativo).
- **Hosting**: sin decidir aún; el stack elegido (Next.js + Postgres externo)
  es desplegable en Vercel u otros proveedores sin cambios de arquitectura.

## 4. Modelo de datos

```
activities
  id                    uuid pk
  source                enum: bitacora | manual | google_calendar
  external_id           text null        -- id de Bitácora, único, evita duplicados
  title                 text
  activity_type         text             -- catálogo o texto libre ("Otro")
  status                enum: ejecutada | programada | pendiente | externa
  color                 text             -- derivado de status, ver regla 4.1
  start_datetime        timestamptz
  end_datetime          timestamptz
  description           text null
  location              text null
  sync_status           enum: synced | pending | error
  sync_error_message    text null
  created_by            enum: admin | public | bitacora
  google_event_id       text null        -- id del evento espejo en Google
  reminders_configured  boolean default false
  booking_token         uuid null        -- solo si created_by = public
  booker_name           text null
  booker_email          text null
  deleted_at            timestamptz null -- soft delete (incl. eliminados en Google)
  created_at            timestamptz
  updated_at            timestamptz

activity_types
  id            uuid pk
  name          text
  is_active     boolean default true

app_config                      -- fila única (single-tenant)
  id                    uuid pk
  work_hours_start      text     -- ej. "08:00"
  work_hours_end        text     -- ej. "19:00"
  timezone              text     default 'America/Santiago'
  conflict_policy       enum: block | warn
  google_calendar_id    text null
  google_refresh_token  text null  -- cifrado en reposo
  admin_email           text null
  google_sync_token     text null  -- syncToken incremental del cron
```

### 4.1 Regla de color

El color se deriva de `status`, no de `activity_type`:
- `ejecutada` → verde
- `programada` → azul
- `pendiente` → naranjo
- `externa` (proveniente de Google Calendar) → plomo

Esto evita que cada nuevo `activity_type` necesite un color propio y mantiene
la leyenda de colores fija y predecible, tal como exige el criterio de
aceptación de "leyenda de colores visible".

## 5. Flujos principales

### 5.1 Onboarding del administrador (una sola vez)
1. Login con Google OAuth (Auth.js), scopes de Calendar incluidos.
2. Se guarda `refresh_token` cifrado en `app_config`.
3. El admin elige su `google_calendar_id` de la lista de calendarios de su
   cuenta (`calendarList.list`) o lo ingresa manualmente.
4. Configura horario laboral, zona horaria y política de conflicto
   (`block` o `warn`).

### 5.2 Registro manual desde el panel privado
1. Admin abre el formulario de nueva actividad.
2. Elige `activity_type` del catálogo o "Otro" + texto libre.
3. Define fecha, hora de inicio y hora de término (rangos libres con
   minutos, ej. 15:00–17:30).
4. El sistema valida solapamiento contra todas las actividades visibles
   (bitácora + manual + google_calendar) en ese rango.
5. Si hay conflicto: según `conflict_policy`, bloquea el guardado o pide
   confirmación explícita.
6. Al guardar: inserta en `activities` con `status=programada`,
   `sync_status=pending`.
7. Llama a Google Calendar API (`events.insert`) creando el evento con los
   3 reminders nativos (1 día, 30 min, 5 min antes).
8. Si la llamada tiene éxito: `sync_status=synced`, guarda `google_event_id`,
   `reminders_configured=true`.
9. Si falla: `sync_status=error` + `sync_error_message`; la actividad queda
   visible en el calendario igualmente, marcada con indicador de error y
   botón de reintento manual.

### 5.3 Registro desde Bitácora (módulo interno)
1. Formulario simple dentro del panel para registrar una actividad ya
   ejecutada (corte de pasto, mantenimiento realizado, etc).
2. Se guarda con `source=bitacora`, `status=ejecutada`, `created_by=bitacora`
   y un `external_id` autogenerado único (constraint único en base de
   datos) para evitar duplicados si el mismo registro se reenvía.
3. No se sincroniza hacia Google Calendar (son hechos consumados, no
   bloquean disponibilidad futura); solo aparece en la vista de calendario.

### 5.4 Sincronización entrante (cron cada 5 minutos)
1. El job llama `events.list` usando el `google_sync_token` guardado.
2. Por cada evento nuevo/modificado en Google que no tenga origen `manual`
   propio (identificado por `google_event_id`): hace upsert en `activities`
   con `source=google_calendar`, `status=externa`, `created_by=admin`.
3. Por cada evento eliminado en Google: marca la actividad correspondiente
   con `deleted_at` (soft delete), deja de mostrarse en el calendario.
4. Guarda el nuevo `syncToken` devuelto por Google para la próxima corrida.
5. Si el `syncToken` expira (error 410 de Google), se hace una carga
   completa (`events.list` sin `syncToken`) y se reinicia el token.

### 5.5 Portal público de agendamiento (`/reservar`)
1. Cliente visita `/reservar` sin necesidad de login.
2. Ve huecos libres calculados como: horario laboral configurado menos
   actividades existentes de todas las fuentes (solo se muestra
   ocupado/libre, sin detalle de la actividad ajena, por privacidad).
3. Elige un slot, completa formulario (nombre, email, motivo/tipo).
4. El sistema revalida el conflicto en el momento de confirmar (por si
   cambió desde que cargó la página).
5. Crea la actividad: `created_by=public`, `status=programada`,
   `booking_token` (UUID nuevo), `booker_name`, `booker_email`.
6. Sincroniza a Google Calendar igual que el flujo manual (5.2, pasos 7-9).
7. Envía email (Resend) al `booker_email` con el link
   `/reservar/gestionar/[booking_token]`.

### 5.6 Gestión pública de una reserva existente
1. Cliente abre su link único `/reservar/gestionar/[token]`.
2. El sistema valida que el token exista y corresponda a una actividad no
   eliminada.
3. Cliente puede reprogramar (nuevo horario, revalida conflicto igual que
   5.5.4) o cancelar la reserva.
4. Los cambios se reflejan en Google Calendar: `events.update` o
   `events.delete` sobre el `google_event_id` asociado.

## 6. Reglas de negocio

- La hora de término debe ser siempre posterior a la de inicio.
- Zona horaria consistente en todo el sistema: `America/Santiago` (configurable
  en `app_config.timezone`).
- Antes de guardar cualquier actividad manual o pública, se valida conflicto
  contra **todas** las fuentes visibles (bitácora, manual, google_calendar).
- Ante superposición: bloquear o pedir confirmación según
  `app_config.conflict_policy`.
- Las actividades de Bitácora conservan `external_id` único para evitar
  duplicados ante reenvíos.
- Los eventos de Google Calendar conservan su `google_event_id` para permitir
  updates/deletes posteriores.
- La edición o eliminación de una actividad sincronizada se refleja en la
  otra plataforma (Google ↔ nuestra app).
- Usar "Otro" en el tipo de actividad no modifica automáticamente el catálogo
  `activity_types` (requiere acción explícita del administrador para
  agregarlo como tipo parametrizado).
- Toda integración opera únicamente sobre el `google_calendar_id` configurado
  y con el `refresh_token` autorizado explícitamente por el administrador.
- Credenciales, tokens y el `google_refresh_token` se almacenan cifrados en
  base de datos y nunca se exponen en la interfaz ni en el código fuente.

## 7. Manejo de errores y casos límite

| Situación | Respuesta del sistema |
|---|---|
| Falla la conexión con Google al crear/editar un evento | `sync_status=error` + mensaje, actividad visible y reintentable manualmente; el cron también reintentará en su próxima corrida si aplica |
| Token OAuth expirado o revocado | Banner visible en `/panel` pidiendo reconexión; se bloquean nuevas sincronizaciones hasta reconectar, sin perder datos ya guardados localmente |
| Bitácora reenvía el mismo registro | Constraint único en `external_id`; se hace upsert, no se duplica |
| Evento modificado directamente en Google | Detectado por el cron de sincronización entrante (5.4), refleja el cambio en la vista |
| Evento atraviesa medianoche | Se valida fecha-hora completa (no solo hora); se muestra en los días involucrados en la vista de calendario |
| `syncToken` expirado (error 410) | Se hace carga completa y se reinicia el token, sin intervención manual |
| No hay `google_calendar_id` o token válido configurado | Se impide leer/crear eventos, se informa el problema en el panel y se solicita reconexión/configuración antes de permitir sincronizar |
| Conflicto de horario detectado | Bloquea o advierte según `conflict_policy`, nunca permite guardar silenciosamente una superposición |

## 8. UI

**Panel privado (`/panel`, protegido por login Google OAuth admin)**
- Vista de calendario mensual/semanal/diaria (`react-big-calendar` sobre
  Tailwind), con leyenda de colores fija (verde/azul/naranjo/plomo).
- Modal de nueva actividad manual.
- Formulario simple de registro de Bitácora.
- `/panel/config`: horario laboral, política de conflicto, `google_calendar_id`,
  estado de conexión Google (conectado / requiere reconexión).
- Indicador visual (ícono de alerta + botón "reintentar") en actividades con
  `sync_status=error`.

**Portal público (`/reservar`, sin login)**
- Vista de huecos disponibles (semanal), mostrando solo ocupado/libre.
- Formulario de reserva (nombre, email, motivo, slot elegido).
- Página de confirmación post-reserva.
- `/reservar/gestionar/[token]`: ver, reprogramar o cancelar la reserva
  propia.

## 9. Testing

- **Unitarios**: detección de solapamiento de horarios, derivación de color
  por `status`, cálculo de huecos libres a partir de horario laboral +
  actividades existentes.
- **Integración**: Server Actions de creación/edición/cancelación de
  actividad contra una base de datos Postgres de test (Docker local o Neon
  branch), con la Google Calendar API mockeada.
- **E2E (Playwright, alcance reducido)**: flujo feliz completo de
  agendamiento público, y flujo de conflicto bloqueado en `/reservar`.

## 10. Datos que debe proporcionar el cliente antes de implementar la integración

- Cuenta de Google que usará la integración (la misma con la que hará login
  como administrador).
- Confirmación del calendario específico (`google_calendar_id`) a sincronizar.
- Acceso para crear un proyecto de Google Cloud, habilitar la Calendar API,
  configurar la pantalla de consentimiento OAuth y generar credenciales
  (Client ID / Secret) — puede hacerlo el propio desarrollador si el cliente
  da acceso a su cuenta de Google Cloud, o el cliente lo hace siguiendo una
  guía.
- Correo donde recibirá notificaciones administrativas (ej. alertas de token
  expirado).
