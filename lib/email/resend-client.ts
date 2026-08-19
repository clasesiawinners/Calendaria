import { Resend } from "resend";
import { formatInTimeZone } from "date-fns-tz";

export interface BookingEmailInput {
  to: string;
  bookerName: string;
  manageUrl: string;
  activityTitle: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface ResendLike {
  emails: {
    send(input: {
      from: string;
      to: string[];
      subject: string;
      html: string;
    }): Promise<{ data: { id: string } | null; error: { name: string; message: string } | null }>;
  };
}

function formatRange(start: Date, end: Date, timezone: string): string {
  const day = formatInTimeZone(start, timezone, "dd/MM/yyyy");
  const startTime = formatInTimeZone(start, timezone, "HH:mm");
  const endTime = formatInTimeZone(end, timezone, "HH:mm");
  return `${day} de ${startTime} a ${endTime}`;
}

export async function sendBookingConfirmationEmail(
  client: ResendLike,
  input: BookingEmailInput
): Promise<void> {
  const from = process.env.BOOKING_EMAIL_FROM ?? "reservas@example.com";
  const range = formatRange(input.start, input.end, input.timezone);

  const { error } = await client.emails.send({
    from,
    to: [input.to],
    subject: `Confirmación de reserva: ${input.activityTitle}`,
    html: `
      <p>Hola ${input.bookerName},</p>
      <p>Tu reserva de <strong>${input.activityTitle}</strong> para el <strong>${range}</strong> quedó confirmada.</p>
      <p>Puedes ver, reprogramar o cancelar tu reserva en cualquier momento desde este link:</p>
      <p><a href="${input.manageUrl}">${input.manageUrl}</a></p>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export function createResendClient(): ResendLike {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY no está definida");
  }
  return new Resend(process.env.RESEND_API_KEY) as unknown as ResendLike;
}
