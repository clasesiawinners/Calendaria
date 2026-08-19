import { describe, it, expect, vi } from "vitest";
import { sendBookingConfirmationEmail } from "./resend-client";
import type { ResendLike } from "./resend-client";

function makeFakeResend(): ResendLike {
  return {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }),
    },
  };
}

describe("sendBookingConfirmationEmail", () => {
  it("envía el correo con el link de gestión y los datos de la reserva", async () => {
    const resend = makeFakeResend();

    await sendBookingConfirmationEmail(resend, {
      to: "cliente@example.com",
      bookerName: "Ana Pérez",
      manageUrl: "https://example.com/reservar/gestionar/abc-123",
      activityTitle: "Cancha 1",
      start: new Date("2026-08-24T14:00:00.000Z"),
      end: new Date("2026-08-24T15:00:00.000Z"),
      timezone: "America/Santiago",
    });

    expect(resend.emails.send).toHaveBeenCalledOnce();
    const call = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toEqual(["cliente@example.com"]);
    expect(call.html).toContain("https://example.com/reservar/gestionar/abc-123");
    expect(call.html).toContain("Ana Pérez");
  });

  it("lanza un error si Resend responde con error", async () => {
    const resend = makeFakeResend();
    (resend.emails.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "invalid `to` field" },
    });

    await expect(
      sendBookingConfirmationEmail(resend, {
        to: "invalido",
        bookerName: "Ana",
        manageUrl: "https://example.com/x",
        activityTitle: "Cancha 1",
        start: new Date(),
        end: new Date(),
        timezone: "America/Santiago",
      })
    ).rejects.toThrow("invalid `to` field");
  });
});
