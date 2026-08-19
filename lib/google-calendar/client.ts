import { google } from "googleapis";

export interface EventInput {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

export interface GoogleCalendarClient {
  insertEvent(input: EventInput): Promise<{ googleEventId: string }>;
  updateEvent(googleEventId: string, input: EventInput): Promise<void>;
  deleteEvent(googleEventId: string): Promise<void>;
  listEvents(syncToken?: string): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string }>;
}

const REMINDER_OVERRIDES = [
  { method: "email" as const, minutes: 24 * 60 },
  { method: "email" as const, minutes: 30 },
  { method: "email" as const, minutes: 5 },
];

function toEventRequestBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    reminders: {
      useDefault: false,
      overrides: REMINDER_OVERRIDES,
    },
  };
}

// Vitest 4 mockea clases con `vi.fn().mockImplementation(() => ({...}))`, que no es
// invocable con `new` (no tiene [[Construct]]). En producción, `google.auth.OAuth2` es
// una clase ES6 real que sí requiere `new`. Este helper prueba `new` primero (camino real)
// y cae a invocación directa si el target no es constructible (mocks de test).
function construct<T>(Ctor: abstract new (...args: never[]) => T, ...args: unknown[]): T {
  try {
    return new (Ctor as new (...args: unknown[]) => T)(...args);
  } catch (error) {
    if (error instanceof TypeError) {
      return (Ctor as unknown as (...args: unknown[]) => T)(...args);
    }
    throw error;
  }
}

export function createGoogleCalendarClient(config: {
  calendarId: string;
  refreshToken: string;
}): GoogleCalendarClient {
  const oauth2Client = construct<InstanceType<typeof google.auth.OAuth2>>(
    google.auth.OAuth2,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  return {
    async insertEvent(input) {
      const response = await calendar.events.insert({
        calendarId: config.calendarId,
        requestBody: toEventRequestBody(input),
      });
      return { googleEventId: response.data.id! };
    },

    async updateEvent(googleEventId, input) {
      await calendar.events.update({
        calendarId: config.calendarId,
        eventId: googleEventId,
        requestBody: toEventRequestBody(input),
      });
    },

    async deleteEvent(googleEventId) {
      await calendar.events.delete({
        calendarId: config.calendarId,
        eventId: googleEventId,
      });
    },

    async listEvents(syncToken) {
      const response = await calendar.events.list({
        calendarId: config.calendarId,
        syncToken,
      });
      return {
        events: (response.data.items ?? []) as GoogleCalendarEvent[],
        nextSyncToken: response.data.nextSyncToken ?? "",
      };
    },
  };
}
