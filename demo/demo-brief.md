# Stand-in demo brief (locked story; production starts after the 19:00 IST completion check)

Status: story DRAFT for Gabriel's lock, 14 Nov. No production until every feature below is checked live
(Gabriel, 14 Nov: "Lock story now, produce after 19:00"; the formal build-complete validator crashes on
a retired Abel file, so a manual completion check replaces it, recorded in `demo-truth-ledger.md`).

## Rules this film must satisfy
- **Where it goes:** a public X post that says it was built at NEAR HACKATHON, tags @NEARProtocol and
  #NEARHackathon (optionally @NearLegion and @NearBuilders), with the video attached. The human posts it.
- **What a good post does (organisers):** lead with the user problem; show one complete moment from a
  real user action to a visible result; say concretely what NEAR enables; give a next step (demo + repo).
  No long intros, architecture slides or setup.
- **Length:** the hackathon sets no limit. The posting account is @BonneyMantra; X caps uploads at 2:20
  for non-Premium accounts. **Target 2:15, never over 2:19.**
- **Judging:** Claude Code and Codex screen the repo first; humans decide, possibly from the video alone.
  The video ends on the hosted lab and the verify page so a judge can check everything in one click.
- **House rules:** `_buildroom/DEMO_MAGIC_ROOM_SPEC.md` (no trust claims, only mechanisms; no UI
  mechanics; no spoken abbreviations; conversational; close with "Thank you."; numbers only from real
  runs, footage from the same run as the numbers) and `_demo-films/BRIEF-COMMON.md` house quality.

## Visual direction (Gabriel, 14 Nov)
- **Style is Stand-in's own:** near-black ink (#08080a to #1f1f25), Geist and Geist Mono, one alarm
  colour (#ff4a3d) used only for a trip or freeze, green (#3ddc97) only for safe, violet (#8b8bff) only for
  decoys. Hairline frames, monochrome sponsor lockups, no emojis, no decorative icons.
- **References set the motion only, never the look:** Grok app-building and Pine Labs P3P
  (`~/Documents/video-library/launch-refs-2026-10-30/`), our approved Qloo-round films Local Edition and
  Wallspace (finals were copied to `~/Downloads/local-edition` and `~/Downloads/wallspace`; no longer
  there: locate before production), and vibrant.design launch films. Borrow: one continuous camera
  through 3D space, an object from one scene becoming the next, real footage inside floating windows the
  camera pushes into, a UI element lifting out to become the explainer.

## One-sentence story
A developer's coding agent runs the test suite, a poisoned package steals the NEAR key it finds, the key
is a decoy, and three blocks later the real account is frozen on NEAR and on every chain it signs for,
with the exact tool call that leaked it on screen.

## The one workflow
A real Claude Code session in a real project, already protected when it opens (proactive, never
click-to-run). Known malware is blocked before it runs; an unflagged package leaks a decoy; the theft
trips the freeze; the owner gets the alert, the report and the attribution; only the owner's fingerprint
undoes it.

## Magic moment (0:46 to 1:12)
Split frame: on the left, the real Claude Code session running `npm test`; on the right, a chain lane.
The theft transaction lands, a block counter ticks 1, 2, 3, and FROZEN stamps across both key
registries while the phone in frame buzzes "Frozen in 3 blocks". The leaking tool call is highlighted in
the terminal at the same instant. The beat is silent for about 3 seconds after "someone uses the key".

## First 8 seconds (hook)
SPEAK: "Coding agents like Claude Code and Codex read the files on your machine. That includes your NEAR keys."
SCREEN: the real session; a Bash tool call prints a NEAR credentials file; the key line lifts out of the
terminal toward the camera and turns violet with the tag "decoy, planted for this session".

## Proof callouts (on screen, each from a real artifact)
- "Frozen 3 blocks after the theft" + theft and freeze tx chips (from the filmed run).
- "intents.near key removed, mainnet" + tx `DEePEB…` (packages/mainnet/README.md).
- "Signing refused: frozen" (Chain Signatures, tx `7vj8xX…`).
- "Incident report signed inside the enclave: 11 of 11 checks" (NEAR AI Cloud proof).
- "Blocklist verdict attested by OutLayer" + attestation link (tx `51t83J…`).
- "20 attacks · 11 of 11 thefts frozen · median 3 blocks · Stand-in off: 2.4016 NEAR lost" (bench/results.json).
- End card: hosted lab URL, `/verify`, repo.

## Beats (SPEAK + SCREEN, target 2:15)
| Time | SPEAK | SCREEN | Depends on |
|---|---|---|---|
| 0:00–0:08 | Hook (above). | Real session, key lifts out, turns decoy. | Filmed session |
| 0:08–0:20 | "In public commits made with Claude Code, about three in a hundred leak a secret, and scanners find a leaked key in about twenty seconds." | Two stat objects with their sources (GitGuardian 3.2%; NC State, 20 s median). | Sourced (landing content.ts) |
| 0:20–0:34 | "Stand-in moves your real key out of the agent's reach and gives the agent a key that can only call your contract. Every session gets its own decoys: NEAR keys that belong to a bait account a watcher follows on chain, plus web and DNS tokens that alert you even if the thief never touches the chain." | `standin adopt` result morphs into the decoy map; nodes per session; canary tokens orbit the session. | Canary (done, fd16aac) |
| 0:34–0:46 | "Known malware never runs. Before the agent installs anything, Stand-in checks Google's open-source vulnerability database and blocks packages marked malicious." | Agent tries the install; the hook's deny message with the advisory id. | OSV deny (done, fd16aac) |
| 0:46–1:12 | "Now a package nobody has flagged yet. The agent runs the tests, the test reporter quietly uploads the project's environment file, and someone uses the key. … Three blocks later, the real account is frozen." | Magic moment (above). | Filmed run; phone push (W10) |
| 1:12–1:30 | "The guardian contract on the account deleted the agent's keys and removed its key from NEAR Intents, so nothing it queued can settle. It also refuses the agent's Chain Signatures, so it can't sign on Ethereum either." | Both registries strike through; intents.near (mainnet) chip; the signing request bounces at the guardian. | Done (testnet + mainnet proofs) |
| 1:30–1:45 | "Each session had its own decoy, so the dashboard names the exact session and the tool call that ran the tests. A model running inside a secure enclave on NEAR AI Cloud writes the incident report and signs it, so anyone can check where it came from." | Trip trace with the Bash call highlighted; report panel with 11 of 11 checks. | Done (cce20e3) |
| 1:45–1:57 | "OutLayer checks the theft against chain data inside a secure enclave and adds the thief to a shared blocklist. If an agent is later tricked into paying that account, it refuses." | `standin pay` to the thief → BLOCK receipt. | Done |
| 1:57–2:05 | "Only you can unfreeze the account, with your fingerprint." | `standin unfreeze` → Touch ID prompt → unfrozen. | W10 (Touch ID gate) |
| 2:05–2:15 | "We ran twenty attacks. With Stand-in off they drained about two point four NEAR. With it on, every theft was frozen. You can leak a decoy yourself on our site. Thank you." | Benchmark on/off; end card: lab URL, /verify, repo. | W9 hosted lab + verify page |

Fallback per dependency: if a dependency is not verified live by 19:30, its beat is cut (never filmed on
empty or fake data) and the neighbouring beats close the gap; the end card falls back to repo + README.

## Numbers whitelist (nothing else is spoken or shown)
3 blocks (filmed run; must equal that run's chain-read value), 3.2%, ~20 seconds, 20 attacks, 11 of 11,
median 3 blocks, 2.4016 NEAR (spoken "about two point four"), 11 of 11 checks, MAL-2025-47141.

## Voice-over
Narrated (organisers and judges may watch on mute: every line is also captioned). Persona is
@BonneyMantra. **Gabriel decides the voice:** recommended a calm, natural ElevenLabs stock voice that fits
the persona; alternative, Gabriel's cloned voice. Budget at most 4,000 ElevenLabs characters including retries.
No on-camera presenter.

**Model (Gabriel, 14 Nov: always ElevenLabs' latest):** `eleven_v4` (Eleven v4, released 28 Sep 2026;
docs: elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4). Use its capabilities:
- inline audio tags for delivery, used sparingly to keep the dry register: [calm], [matter-of-fact],
  [short pause], [long pause] before "Three blocks later";
- context stitching: generate the whole script as one request or pass previous/next text, so pacing holds
  across lines;
- Stability and Similarity are the only two settings; start Stability mid, Similarity high;
- the `/v1/text-to-speech/:voice_id/with-timestamps` endpoint for character-level timings that drive
  captions and cue placement. Confirm with one short test line that `eleven_v4` returns alignment
  before the full run; if it does not, generate with v4 and align with forced alignment instead of
  dropping to an older model.

## Generated media
None. Pure motion graphics plus real app and terminal footage (house rule from the Qloo-round films). No
Higgsfield spend. Music: Mixkit free-licence track, three auditioned; SFX only from Gabriel's Drive library.

## Open decisions for Gabriel
1. Lock this story and beat list, or change it.
2. Voice: stock voice matched to the persona (recommended) or his cloned voice.
3. Is @BonneyMantra on X Premium? If yes, a 2:45 cut can add the benchmark and the hosted lab on screen.
