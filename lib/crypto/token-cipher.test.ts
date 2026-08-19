import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./token-cipher";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
});

describe("token-cipher", () => {
  it("cifra y descifra un token, recuperando el valor original", () => {
    const original = "ya29.a0AfH6SMB_example_refresh_token";
    const cipher = encryptToken(original);
    expect(cipher).not.toBe(original);
    expect(decryptToken(cipher)).toBe(original);
  });

  it("genera un cifrado distinto cada vez (IV aleatorio) para el mismo input", () => {
    const original = "same-token";
    const cipher1 = encryptToken(original);
    const cipher2 = encryptToken(original);
    expect(cipher1).not.toBe(cipher2);
    expect(decryptToken(cipher1)).toBe(original);
    expect(decryptToken(cipher2)).toBe(original);
  });
});
