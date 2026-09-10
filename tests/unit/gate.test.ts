import { describe, it, expect } from "vitest";
import { deriveDisposition, pickHeadlineType } from "../../convex/gate";
import type { ConflictKind, FetchStatus, ExtractionConfidence } from "../../convex/contract";

// TESTING.md §2 — gate.ts.

describe("pickHeadlineType — D-10a priority identity > privilege > status", () => {
  it("single kinds return themselves", () => {
    expect(pickHeadlineType(["status"])).toBe("status");
    expect(pickHeadlineType(["privilege"])).toBe("privilege");
    expect(pickHeadlineType(["identity"])).toBe("identity");
  });

  it("every multi-kind subset returns the highest priority", () => {
    expect(pickHeadlineType(["status", "privilege"])).toBe("privilege");
    expect(pickHeadlineType(["privilege", "status"])).toBe("privilege");
    expect(pickHeadlineType(["status", "identity"])).toBe("identity");
    expect(pickHeadlineType(["identity", "privilege"])).toBe("identity");
    expect(pickHeadlineType(["status", "privilege", "identity"])).toBe("identity");
    expect(pickHeadlineType(["identity", "privilege", "status"])).toBe("identity");
  });

  it("throws on an empty set (only ever called on a conflict)", () => {
    expect(() => pickHeadlineType([])).toThrow();
  });
});

describe("deriveDisposition — fail closed first, then union every conflict kind", () => {
  const ok = (over: Partial<Parameters<typeof deriveDisposition>[0]> = {}) =>
    deriveDisposition({
      fetch_status: "ok",
      confidence: "high",
      diffKinds: [],
      identityOk: true,
      privilegeOk: true,
      caseAlreadyOpen: false,
      ...over,
    });

  it("all good ⇒ confirmed, no detected kinds", () => {
    expect(ok()).toEqual({ disposition: "confirmed", detected: [] });
  });

  it("all good BUT a case is already open ⇒ unconfirmed (I4 gates confirmation)", () => {
    expect(ok({ caseAlreadyOpen: true })).toEqual({ disposition: "unconfirmed", detected: [] });
  });

  it("a NEW conflict while a case is open still reports conflict (dedup handled by create_mismatch_case)", () => {
    expect(ok({ caseAlreadyOpen: true, diffKinds: ["status"] })).toEqual({
      disposition: "conflict",
      detected: ["status"],
    });
  });

  it.each<FetchStatus>([
    "http_error",
    "blocked",
    "rate_limited",
    "timeout",
    "extraction_failed",
    "extraction_refused",
  ])("fetch_status %s ⇒ unconfirmed (I6), even with clean verdicts", (fs) => {
    expect(ok({ fetch_status: fs, diffKinds: ["status"], identityOk: false, privilegeOk: false })).toEqual({
      disposition: "unconfirmed",
      detected: [],
    });
  });

  it("confidence low ⇒ unconfirmed even with an agreeing diff", () => {
    expect(ok({ confidence: "low" as ExtractionConfidence })).toEqual({
      disposition: "unconfirmed",
      detected: [],
    });
  });

  it("confidence null (no extraction) ⇒ unconfirmed", () => {
    expect(ok({ confidence: null })).toEqual({ disposition: "unconfirmed", detected: [] });
  });

  it("confidence medium is acceptable", () => {
    expect(ok({ confidence: "medium" }).disposition).toBe("confirmed");
  });

  it("diff status conflict ⇒ conflict, detected [status]", () => {
    expect(ok({ diffKinds: ["status"] })).toEqual({ disposition: "conflict", detected: ["status"] });
  });

  it("identity blocked ⇒ conflict, detected [identity]", () => {
    expect(ok({ identityOk: false })).toEqual({ disposition: "conflict", detected: ["identity"] });
  });

  it("privilege invalid ⇒ conflict, detected [privilege]", () => {
    expect(ok({ privilegeOk: false })).toEqual({ disposition: "conflict", detected: ["privilege"] });
  });

  it("status + privilege together ⇒ conflict, detected has both", () => {
    const r = ok({ diffKinds: ["status"], privilegeOk: false });
    expect(r.disposition).toBe("conflict");
    expect([...r.detected].sort()).toEqual(["privilege", "status"]);
  });

  it("all three kinds ⇒ conflict, detected has all three; headline is identity", () => {
    const r = ok({ diffKinds: ["status"], identityOk: false, privilegeOk: false });
    expect([...r.detected].sort()).toEqual(["identity", "privilege", "status"]);
    expect(pickHeadlineType(r.detected)).toBe("identity");
  });

  it("diffKinds may itself carry identity/privilege (name/number/privilege_type field changes)", () => {
    const r = ok({ diffKinds: ["identity", "privilege"] as ConflictKind[] });
    expect([...r.detected].sort()).toEqual(["identity", "privilege"]);
  });

  it("deduplicates a kind that comes from both the diff and a verdict", () => {
    const r = ok({ diffKinds: ["identity"], identityOk: false });
    expect(r.detected).toEqual(["identity"]);
  });
});
