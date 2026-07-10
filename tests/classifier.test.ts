import { describe, expect, it } from "vitest";
import { classifyPayload, hasEmail, hasJwt, hasPythonNetworking } from "../src/core/classifier.js";
import { redactValue } from "../src/core/redaction.js";

describe("classifier", () => {
  it("detects JWT-like tokens", () => {
    const sample =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDef1234567890";
    expect(hasJwt(sample)).toBe(true);
    const payload = classifyPayload(sample);
    expect(payload.categories).toContain("jwt");
  });

  it("detects emails", () => {
    const sample = "owner=analyst@company.example";
    expect(hasEmail(sample)).toBe(true);
    const payload = classifyPayload(sample);
    expect(payload.categories).toContain("email");
  });

  it("detects python networking code", () => {
    const code = "import requests\nrequests.post('https://api.github.com/gists', json={'x': 1})";
    expect(hasPythonNetworking(code)).toBe(true);
    const payload = classifyPayload(code);
    expect(payload.categories).toContain("python-networking");
    expect(payload.categories).toContain("requests-post");
    expect(payload.categories).toContain("github-api");
    expect(payload.categories).toContain("gist-api");
  });

  it("produces additive classifications", () => {
    const sample =
      "Bearer abcdefghijklmnopqrstuvwxyz123456 email=analyst@company.example id=550e8400-e29b-41d4-a716-446655440000 https://api.github.com";
    const payload = classifyPayload(sample);
    expect(payload.categories).toEqual(
      expect.arrayContaining(["bearer-token", "email", "uuid", "url", "github-api"])
    );
  });

  it("redacts sensitive values without keeping the full value", () => {
    const secret = "ghp_1234567890abcdefghijABCDEFGHIJ";
    const redacted = redactValue("api-key-like", secret);
    expect(redacted.length).toBe(secret.length);
    expect(redacted.evidence).not.toContain(secret);
    expect(redacted.hash).toHaveLength(64);
  });

  it("does not classify runtime transport metadata as token-like secrets", () => {
    const sample = JSON.stringify({
      runtime_host: "runtime-sanitized.prod.colab.dev",
      session_id: "runtime-session-token-sanitized-1234567890",
      kernel_id: "550e8400-e29b-41d4-a716-446655440000",
      notebook_id: "notebook-sanitized-abcdef1234567890"
    });
    const payload = classifyPayload(sample);
    expect(payload.categories).not.toContain("token-like");
    expect(payload.categories).not.toContain("bearer-token");
    expect(payload.categories).toContain("uuid");
    expect(payload.categories).toContain("notebook-metadata");
  });
});
