import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

vi.mock("@/lib/actions/sync-from-google", () => ({
  syncFromGoogle: vi.fn().mockResolvedValue({ created: 1, updated: 0, deleted: 0 }),
}));

import { GET } from "./route";

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

describe("GET /api/cron/sync-google", () => {
  it("rechaza la petición sin el header de autorización correcto", async () => {
    const request = new Request("http://localhost/api/cron/sync-google");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("ejecuta la sincronización cuando el header de autorización es correcto", async () => {
    const request = new Request("http://localhost/api/cron/sync-google", {
      headers: { Authorization: "Bearer test-secret" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ created: 1, updated: 0, deleted: 0 });
  });
});
