import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://test:test@localhost:5433/calendario_test",
      TEST_DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://test:test@localhost:5433/calendario_test",
      // La app llama a createResendClient() al confirmar una reserva incluso cuando
      // el envío de correo termina siendo best-effort (ver lib/actions/create-booking.ts).
      // Sin esta variable, createResendClient() lanza sincrónicamente y el flujo de
      // reserva pública nunca llega a crear la actividad. El envío real a Resend
      // fallará con esta key falsa, pero ese fallo está envuelto en try/catch y no
      // bloquea la reserva (ver nota del brief sobre sync_status=error).
      RESEND_API_KEY: process.env.RESEND_API_KEY ?? "re_test_e2e_placeholder",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
