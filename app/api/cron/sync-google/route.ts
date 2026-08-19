import { db } from "@/lib/db/client";
import { syncFromGoogle } from "@/lib/actions/sync-from-google";
import { createGoogleCalendarClient } from "@/lib/google-calendar/client";

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await syncFromGoogle(db, createGoogleCalendarClient);
  return Response.json(result);
}
