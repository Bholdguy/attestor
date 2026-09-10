# DEMO.md — Attestor

The judge demo. 12 beats, ~2:40 total, built for a **< 3 minute** video and a
live walkthrough. Runs on the deployed `https://<deployment>.convex.site` URL.

**Golden rule:** beats 4–12 run entirely on **demo mode** (fixtures, zero
Firecrawl/OpenAI calls — D-9). Beat 3 is the *one* live-integration proof and is
guarded by a pre-seeded fixture fallback. If Beat 3's live call is slow or fails,
say one sentence and move on — the story does not depend on it.

Pre-roll checklist (before recording):
- [ ] `demo_mode` OFF, roster empty, one browser tab on the deployed URL.
- [ ] `AGENTMAIL` inbox open in a second tab (real sends happen in demo mode too).
- [ ] Fixture Nurse A pre-seeded and hidden behind the "Run demo" seed (fallback for Beat 3).
- [ ] Network is up (only Beat 3 needs it).

---

## Beat 1 — The frame (0:00–0:15, 15s)

**Screen:** empty roster, Attestor title.

**Say:**
> "Coverage tools tell you a license exists. Attestor tells you whether to trust
> what you just saw. It sits between a state board's web page and a staffing
> coordinator's decision to schedule, extend, or pull a nurse."

---

## Beat 2 — Add a worker (0:15–0:30, 15s)

**Do:** click **Add worker**. Enter: name registered `Maria S. Gomez`, name hired
`Maria Gomez`, license `RN-4471102`, issuing `NY`, assignment `NY`. Submit.

**Say:**
> "This roster is just the reference workload — it displays data and starts a
> watch. It never decides anything and never edits a stored status."

**Screen:** the row appears, badge ⚪ **Unconfirmed** (never checked yet).

---

## Beat 3 — One real fetch, live (0:30–0:55, 25s) — *the sponsor-integration proof*

**Do:** click **Check now** on Maria's row (live mode still on).

**Say (while it runs, ~3–6s):**
> "That's a real Firecrawl scrape of the real NY board page, and a real OpenAI
> structured-output call turning the page into typed fields — number, name,
> status, privilege. Firecrawl fetches, OpenAI extracts. Neither one decides."

**Screen:** badge turns 🟢 **Verified**, timestamp shown. Open the snapshot
drawer: **raw board HTML** on the left (as text), **extracted fields** on the
right, `source_mode: live`, `extractor_model: gpt-4.1-mini`.

**If the live call fails:** *"Board's rate-limiting us live — here's the same
thing on our seeded fixture,"* then continue. (Fixture Nurse A is already seeded.)

---

## Beat 4 — Switch to deterministic demo mode (0:55–1:05, 10s)

**Do:** open **Demo panel**, toggle **Run demo**.

**Say:**
> "Now I'll switch to demo mode. From here on it's seeded fixtures on a
> compressed schedule — no live board, fully repeatable. Everything downstream is
> the exact same code. The alerts are still real email."

**Screen:** persistent **"DEMO DATA — fixtures, not a live board"** banner
appears. Roster seeds Nurses A–D.

---

## Beat 5 — The live mismatch, caught (1:05–1:25, 20s)

**Do:** watch Nurse A's timeline. The compressed re-check fires; fixture flips
`Active → Expired`.

**Say:**
> "Second fetch. The board now says Expired where it said Active. Watch what
> Attestor does *not* do — it does not overwrite the status."

**Screen:** badge flips 🟢 → 🟠 **Needs Review**. A mismatch case appears. The
confirmed-snapshot pointer is visibly unchanged (still points at T1).

---

## Beat 6 — Append-only proof (1:25–1:40, 15s)

**Do:** open Nurse A's timeline; click T1 then T2.

**Say:**
> "Both fetches are still here. T1 Active, T2 Expired, each with the raw board
> text behind it. Nothing was mutated — the current status is just a pointer to
> the last *confirmed* snapshot, and that pointer never moved."

**Screen:** timeline with two distinct dots; T2 marked `disposition: conflict`.

---

## Beat 7 — The compare view (1:40–1:52, 12s)

**Do:** open the case → **Compare**.

**Say:**
> "T1 versus T2, field by field. The status row is highlighted, and here's the
> plain-language reason it was flagged instead of silently accepted."

**Screen:** side-by-side; `status_normalized` row highlighted; reason string
visible.

---

## Beat 8 — The alert, with evidence (1:52–2:05, 13s)

**Do:** switch to the AgentMail inbox tab.

**Say:**
> "One email per case — not per re-fetch. Both snapshots as a table, and the full
> case as a JSON attachment. This is the trust-carrying channel: it only fires
> when there's something worth a human's attention."

**Screen:** the AgentMail message, both-snapshot table, `case.json` attachment.

---

## Beat 9 — Identity flag, distinct from status (2:05–2:18, 13s)

**Do:** back to Attestor; open Nurse B (name-mismatch fixture). Open its case.

**Say:**
> "Nurse B's board record now shows a different surname than the one we hired.
> That's not a status problem — it's an identity case, `legal_name_change`.
> Attestor never reconciles a name change silently and never matches on a name
> string alone; it needs the license number *and* the registered name."

**Screen:** case `type: identity`, `mismatch_reason: legal_name_change`.

---

## Beat 10 — Privilege flag, checked against assignment (2:18–2:30, 12s)

**Do:** open Nurse C (compact-in-non-compact fixture). Open its case.

**Say:**
> "Nurse C holds a multistate license, but the assignment state isn't a compact
> member and the nurse's primary residence isn't either. 'Multistate' doesn't
> mean 'usable anywhere.' Privilege case — checked against the *actual*
> assignment, every fetch."

**Screen:** case `type: privilege`,
`reason: multistate_but_assignment_state_mismatch`.

---

## Beat 11 — Human resolves; system never auto-clears (2:30–2:42, 12s)

**Do:** on Nurse A's case, click **Resolve → Confirm**, actor `nurse-ops`, note
`Board confirms expiry — worker pulled from schedule.` Submit.

**Say:**
> "Only an explicit human action closes a case, and it's recorded — who, when,
> why. Nothing in the loop auto-clears."

**Screen:** case → `Confirmed`; badge leaves 🟠; `resolve` row in the audit
timeline with the actor and note.

---

## Beat 12 — The six-week close (2:42–2:55, 13s)

**Do:** open Nurse D — six weeks of history, four re-checks, the fourth catching
a suspension.

**Say (closing line):**
> "Nurse D was Verified at hire six weeks ago. A hire-time-only check would still
> show this nurse Active today. Attestor caught the suspension on schedule — not
> by accident."

**Screen:** Nurse D timeline: `active, active, active, suspended` → 🟠 + alert.
Freeze on the caption.

---

## Timing summary

| Beats | Segment | Cumulative |
|---|---|---|
| 1–2 | frame + add worker | 0:30 |
| 3 | live sponsor proof | 0:55 |
| 4–8 | demo mode: mismatch → append-only → compare → alert | 2:05 |
| 9–10 | identity + privilege flags | 2:30 |
| 11–12 | human resolve + six-week close | 2:55 |

Total **2:55**, under the 3-minute cap with ~5s of headroom.

---

## Fallbacks

| If… | Do |
|---|---|
| Beat 3 live Firecrawl/OpenAI slow or errors | one sentence, switch to the pre-seeded fixture Nurse A, continue |
| AgentMail send fails during demo | show the case UI's `alert: failed` state — "the case stays open, the failure is visible, nothing is lost"; it still proves the gate |
| Deployed URL slow | the demo sequence is server-driven; wait one compressed tick, narration covers it |
| Someone asks "is this real data?" | "The live fetch in Beat 3 was real. Everything after the banner is labelled fixture data, on purpose, so the demo is deterministic." |
