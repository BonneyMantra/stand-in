# @standin/nearai

Private, attested incident reports. When a decoy key trips, a model running inside a TEE on NEAR AI Cloud writes the
incident report from a redacted evidence packet, and the report is stored with the proof that it came from attested hardware.

```
node --import tsx packages/nearai/scripts/report.ts <trip_tx_hash> [--ledger <path>] [--model <id>]
node --import tsx packages/nearai/scripts/scan-leaks.ts <file-or-dir>...   # secret / home path scan
```
`--ledger` is where the trip and its session/exposure context are read; the `incident_report` event is written to
`$STANDIN_HOME/ledger.ndjson`. The full attestation report (quote, event log, GPU payload) is kept beside it in
`$STANDIN_HOME/nearai/<chat_id>.attestation.json` for independent verification.

The watcher calls `reportInBackground(trip)` after a freeze only when `NEARAI_API_KEY` is set and `STANDIN_NO_AI != "1"`.
It runs on a detached timer and swallows errors: it never blocks or delays a freeze.

## API used (checked against the docs and live responses, 2026-11-14)
| Purpose | Endpoint | Doc |
|---|---|---|
| Base URL (OpenAI compatible) | `https://cloud-api.near.ai/v1` | https://docs.near.ai/cloud/inference-sdk |
| Models and per-1M-token pricing | `GET /v1/models` (`pricing.input`, `pricing.output`, USD per 1M tokens) | live response |
| Chat | `POST /v1/chat/completions` with `x-no-aliasing: true` (the model id is part of the signed text) | https://docs.near.ai/cloud/verification/cloud-api/response-signatures |
| Attestation | `GET /v1/attestation/report?model=&provider=near&signing_algo=ecdsa&nonce=<64 hex>` returns `gateway_attestation` and `model_attestations[]` (free) | https://docs.near.ai/cloud/verification/cloud-api/model-attestations |
| Response signature | `GET /v1/signature/{chat_id}?model=&signing_algo=ecdsa` returns `{text, signature, signing_address, signing_algo, signature_kind}` | https://docs.near.ai/cloud/verification/chat |

Attestation is fetched BEFORE the completion with a fresh 32-byte nonce (the docs say a report fetched afterwards cannot stand in
for preflight evidence). Signed text for `provider_tee` is `{model_id}:{sha256(request body)}:{sha256(response body)}`;
we hash the exact bytes we sent and received. ECDSA is EIP-191 personal sign.

## Model
`Qwen/Qwen3.8-27B` (open weights, `owned_by: nearai` in `/v1/models`, served from NEAR AI's TEE fleet; every attestation
call returned a TDX quote and GPU evidence for it). Input $0.04/M, output $1.35/M tokens from `/v1/models`. Override with `NEARAI_MODEL`.
Requests set `chat_template_kwargs.enable_thinking=false`: `z-ai/glm-5.3-flash` (also nearai-owned) was tried first, but its
reasoning tokens consumed the whole 900-token budget twice (no JSON returned; both calls billed, about $0.0005 each) and
`reasoning_effort` low/minimal/none did not reliably cut them. Qwen3.8-27B with thinking off returns the JSON in about 300 tokens.
No `anthropic/*` or `openai/*` (proxied) models are used.

## Spend cap (enforced by code)
`src/spend.ts` appends `{at, model, prompt_tokens, completion_tokens, usd}` to the gitignored spend ledger `nearai-spend.ndjson`
(in the repo's secrets directory) after every call and throws `SpendCapError` BEFORE sending when recorded spend + worst case for the
next call (`max_tokens` 900 x output price + estimated prompt tokens x input price) would exceed `$2.00`. Prices come from
`/v1/models`; if absent the fallback is $3/M in, $15/M out. Unit-tested (`test/nearai.test.ts`). The ledger path is fixed in code.

## Redaction
Every string in the evidence packet passes `redact()`: the same rule as `apps/web/src/data/build-demo-state.mjs` (60+ char base58,
optionally `ed25519:`-prefixed, becomes `<redacted>`), plus `sk-...` tokens, secret-style assignments, the loaded API value itself,
and absolute home directories (become `~`). Only the decoy PUBLIC key is sent. The model's own output is redacted again before it is stored.

## What the proof verifies locally (and what it does not)
Verified in code (`src/verify.ts`), each as a named entry in `proof.checks[]`:
- `request_nonce` echoed by the gateway report and the model report equals the nonce we sent.
- The nonce and the signing address both appear inside the 64-byte `report_data` of the parsed Intel TDX quote (v4, tee type 0x81).
- `MRCONFIGID == 01 || sha256(app_compose) || 15 zero bytes` for both reports.
- The response signature recovers (EIP-191, secp256k1) to `signing_address`.
- The signed text equals `{model}:{sha256(our request bytes)}:{sha256(our response bytes)}`.
- The signer equals the signing address in the preflight model (or gateway) attestation.

NOT verified locally, always listed in `proof.unverified[]`:
- Intel's DCAP certificate chain and TCB status of the TDX quotes (no DCAP verifier in this package; use https://cloud.near.ai/verify or `dcap-qvl` with the stored quote).
- RTMR3 event-log replay.
- NVIDIA GPU evidence (only its presence is recorded).

`proof.verified` is true only when the signature exists and every signature and attestation check passed. It means "the local
checks above passed", not "Intel's chain was validated".

## Measured
Real calls on 2026-11-14 against `cloud-api.near.ai`; reports written to the sandbox home `.sandbox/nearai/.standin` and copied into
the default watcher home ledger. All three: model `Qwen/Qwen3.8-27B`, `signature_kind: provider_tee`, signer
`0x835ab53d20294ef795906dff21ae4c045336aa26`, every local check passed (11 of 11), the three `unverified` items above remained.

| Trip tx | chat_id | tokens in/out | USD |
|---|---|---|---|
| 8yzSGUvEnor42xFgvcnFAcec75DxjQfgfensb9nzPHkp | 2e8460cb429f4012aaa5f333c0cf8c47 | 631 / 305 | 0.000437 |
| FFauEE4u9rsVdmvYVmdWyNxiAEVPJSWL55zzqbzZ76tE | 9c506b16b4564fa082594d9637fc985a | 588 / 371 | 0.000524 |
| 8VbsWdYZibxKgXdMHVbQqoLienzq8z1tByEf8mHwGcaK | 83925da3c4904071bc9b4d2357472bef | 572 / 335 | 0.000475 |

Total spend per the spend ledger (including 2 failed GLM attempts and 8 short probe calls while choosing the model):
$0.00377 of the $2.00 cap.

Not run: the watcher auto-trigger against a live trip (it is wired; only the unchanged watcher suite covers it, and the
coordinator restarts the watcher), E2EE, streaming, and any model other than the two named above.
