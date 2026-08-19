import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const listMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    calendar: vi.fn().mockImplementation(() => ({
      events: {
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        list: listMock,
      },
    })),
  },
}));

import { createGoogleCalendarClient } from "./client";

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  listMock.mockReset();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

describe("GoogleCalendarClient", () => {
  const config = { calendarId: "primary", refreshToken: "refresh-token" };

  it("crea un evento con los 3 reminders nativos", async () => {
    insertMock.mockResolvedValue({ data: { id: "google-evt-1" } });
    const client = createGoogleCalendarClient(config);

    const result = await client.insertEvent({
      title: "Partido programado",
      start: new Date("2026-08-20T15:00:00Z"),
      end: new Date("2026-08-20T17:30:00Z"),
      timezone: "America/Santiago",
    });

    expect(result.googleEventId).toBe("google-evt-1");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          summary: "Partido programado",
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 24 * 60 },
              { method: "email", minutes: 30 },
              { method: "email", minutes: 5 },
            ],
          },
        }),
      })
    );
  });

  it("actualiza un evento existente", async () => {
    updateMock.mockResolvedValue({ data: { id: "google-evt-1" } });
    const client = createGoogleCalendarClient(config);

    await client.updateEvent("google-evt-1", {
      title: "Partido reprogramado",
      start: new Date("2026-08-21T15:00:00Z"),
      end: new Date("2026-08-21T17:00:00Z"),
      timezone: "America/Santiago",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", eventId: "google-evt-1" })
    );
  });

  it("elimina un evento existente", async () => {
    deleteMock.mockResolvedValue({});
    const client = createGoogleCalendarClient(config);

    await client.deleteEvent("google-evt-1");

    expect(deleteMock).toHaveBeenCalledWith({ calendarId: "primary", eventId: "google-evt-1" });
  });

  it("lista eventos usando syncToken y retorna el nextSyncToken", async () => {
    listMock.mockResolvedValue({
      data: { items: [{ id: "evt-1", status: "confirmed" }], nextSyncToken: "token-abc" },
    });
    const client = createGoogleCalendarClient(config);

    const result = await client.listEvents("previous-token");

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", syncToken: "previous-token" })
    );
    expect(result.nextSyncToken).toBe("token-abc");
    expect(result.events).toHaveLength(1);
  });
});
