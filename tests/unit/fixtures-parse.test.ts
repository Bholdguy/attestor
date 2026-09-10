import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  FIXTURES,
  FIXTURE_LIST,
  DEMO_SEQUENCES,
  getFixture,
  type Fixture,
} from "../../convex/fixtures/index";

const FIX_DIR = join(process.cwd(), "convex", "fixtures");
const GOLDEN_DIR = join(FIX_DIR, "golden");

const EXPECTED_KEYS = [
  "licensee_name",
  "license_number",
  "status_word",
  "status_normalized",
  "issue_date",
  "expire_date",
  "privilege_type",
  "primary_state_of_residence",
  "extraction_confidence",
].sort();

const STATUS_ENUM = ["active", "inactive", "expired", "pending", "revoked", "suspended", "unknown"];
const PRIV_ENUM = ["single_state", "multistate", "unknown"];
const CONF_ENUM = ["high", "medium", "low"];

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("fixtures — manifest integrity", () => {
  it("index.ts is in sync with the .html / golden files (run `npm run fixtures:sync`)", () => {
    const before = readFileSync(join(FIX_DIR, "index.ts"), "utf8");
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "sync-fixtures.mjs")], {
      stdio: "pipe",
    });
    const after = readFileSync(join(FIX_DIR, "index.ts"), "utf8");
    expect(after).toBe(before);
  });

  it("covers every fixture named in TESTING.md §3 (+ the demo T1 helpers)", () => {
    const ids = Object.keys(FIXTURES).sort();
    expect(ids).toEqual(
      [
        "active_clean",
        "blocked_page",
        "flip_active",
        "flip_expired",
        "mc_t1",
        "multi_conflict",
        "name_changed",
        "name_ok",
        "name_wrong_person",
        "not_found",
        "privilege_ok",
        "privilege_violation",
        "suspension_seq_1",
        "suspension_seq_2",
        "suspension_seq_3",
        "suspension_seq_4",
      ].sort(),
    );
    expect(FIXTURE_LIST.length).toBeGreaterThanOrEqual(8);
  });

  it("every .html file on disk has a manifest entry and vice versa", () => {
    const onDisk = readdirSync(FIX_DIR)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""))
      .sort();
    expect(onDisk).toEqual(Object.keys(FIXTURES).sort());
  });
});

describe.each(FIXTURE_LIST)("fixture $id", (fx: Fixture) => {
  it("html is non-empty and matches the file on disk", () => {
    expect(fx.html.length).toBeGreaterThan(200);
    const disk = readFileSync(join(FIX_DIR, `${fx.id}.html`), "utf8");
    expect(fx.html).toBe(disk);
  });

  it("has a stable sha256 (64 hex chars)", () => {
    const h = sha256(fx.html);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // stability: hashing again yields the same value
    expect(sha256(fx.html)).toBe(h);
  });

  it("parses as a well-formed HTML document", () => {
    const html = fx.html.toLowerCase();
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true);
    for (const tag of ["html", "head", "body", "title"]) {
      expect(html).toContain(`<${tag}`);
      expect(html).toContain(`</${tag}>`);
      expect((html.match(new RegExp(`</${tag}>`, "g")) ?? []).length).toBe(1);
    }
    // body sits inside html
    expect(html.indexOf("<html")).toBeLessThan(html.indexOf("<body"));
    expect(html.indexOf("</body>")).toBeLessThan(html.indexOf("</html>"));
  });

  it("fetch_status / http_code are coherent", () => {
    if (fx.expected_outcome.disposition === "unconfirmed") {
      expect(fx.fetch_status).not.toBe("ok");
      expect(fx.fetch_http_code).not.toBe(200);
      expect(fx.expected_fields).toBeNull();
    } else {
      expect(fx.fetch_status).toBe("ok");
      expect(fx.fetch_http_code).toBe(200);
      expect(fx.expected_fields).not.toBeNull();
    }
  });
});

describe("fixtures — golden ExtractedFields", () => {
  const extractable = FIXTURE_LIST.filter((f) => f.expected_fields !== null);

  it.each(extractable)("$id golden matches the checked-in fixtures/golden/$id.json", (fx) => {
    const path = join(GOLDEN_DIR, `${fx.id}.json`);
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(fx.expected_fields).toEqual(onDisk);
  });

  it.each(extractable)("$id golden has exactly the 9 contract keys with valid enum values", (fx) => {
    const g = fx.expected_fields!;
    expect(Object.keys(g).sort()).toEqual(EXPECTED_KEYS);
    expect(STATUS_ENUM).toContain(g.status_normalized);
    expect(PRIV_ENUM).toContain(g.privilege_type);
    expect(CONF_ENUM).toContain(g.extraction_confidence);
    for (const dateKey of ["issue_date", "expire_date"] as const) {
      const v = g[dateKey];
      expect(v === null || typeof v === "string").toBe(true);
    }
    expect(typeof g.licensee_name).toBe("string");
    expect(g.licensee_name.length).toBeGreaterThan(0);
    expect(typeof g.license_number).toBe("string");
    // no SSN / DOB slot ever (SECURITY §1)
    expect(Object.keys(g)).not.toContain("ssn");
    expect(Object.keys(g)).not.toContain("date_of_birth");
    expect(Object.keys(g)).not.toContain("dob");
  });

  it("documents distinct ExtractedFields across the scenario pairs", () => {
    const j = (id: string) => JSON.stringify(getFixture(id).expected_fields);
    expect(j("flip_active")).not.toBe(j("flip_expired")); // status flip
    expect(j("name_ok")).not.toBe(j("name_changed")); // surname change
    expect(j("name_ok")).not.toBe(j("name_wrong_person")); // wrong person
    expect(j("privilege_ok")).not.toBe(j("privilege_violation")); // single→multi
    expect(j("mc_t1")).not.toBe(j("multi_conflict")); // status + privilege
    expect(j("suspension_seq_3")).not.toBe(j("suspension_seq_4")); // active→suspended
  });

  it("all 64-char sha256s are unique across fixtures", () => {
    const hashes = FIXTURE_LIST.map((f) => sha256(f.html));
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("fixtures — expected_outcome intent (documents Step 5–7 targets)", () => {
  const byId = (id: string) => getFixture(id).expected_outcome;

  it("adversarial fixtures are conflicts, not confirmations (M3 target = 0)", () => {
    expect(byId("flip_expired")).toMatchObject({ disposition: "conflict", case_type: "status" });
    expect(byId("name_changed")).toMatchObject({
      disposition: "conflict",
      case_type: "identity",
      mismatch_reason: "legal_name_change",
    });
    expect(byId("name_wrong_person")).toMatchObject({
      disposition: "conflict",
      case_type: "identity",
      mismatch_reason: "wrong_person",
    });
    expect(byId("privilege_violation")).toMatchObject({
      disposition: "conflict",
      case_type: "privilege",
    });
    expect(byId("suspension_seq_4")).toMatchObject({ disposition: "conflict", case_type: "status" });
  });

  it("multi_conflict headline type is privilege, detail keeps both kinds (D-10a)", () => {
    const o = byId("multi_conflict");
    expect(o).toMatchObject({ disposition: "conflict", case_type: "privilege" });
    if (o.disposition === "conflict") {
      expect([...o.detected_types].sort()).toEqual(["privilege", "status"]);
    }
  });

  it("clean fixtures are confirmations (M4 false-flag target = 0)", () => {
    for (const id of ["active_clean", "flip_active", "name_ok", "privilege_ok", "mc_t1", "suspension_seq_1"]) {
      expect(byId(id)).toEqual({ disposition: "confirmed" });
    }
  });
});

describe("fixtures — demo sequences", () => {
  it("every id in DEMO_SEQUENCES resolves to a real fixture", () => {
    for (const [name, ids] of Object.entries(DEMO_SEQUENCES)) {
      expect(ids.length, name).toBeGreaterThan(0);
      for (const id of ids) expect(() => getFixture(id), `${name}:${id}`).not.toThrow();
    }
  });

  it("nurse_a flips active→expired; nurse_d ends on a suspension", () => {
    const a = DEMO_SEQUENCES.nurse_a.map((id) => getFixture(id).expected_fields?.status_normalized);
    expect(a).toEqual(["active", "expired"]);
    const d = DEMO_SEQUENCES.nurse_d.map((id) => getFixture(id).expected_fields?.status_normalized);
    expect(d).toEqual(["active", "active", "active", "suspended"]);
  });
});
