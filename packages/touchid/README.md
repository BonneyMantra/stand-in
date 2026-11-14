# @standin/touchid

Owner-presence gate. `standin-touchid.swift` calls LocalAuthentication
`LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason:)`.
Exit codes: **0** fingerprint accepted, **1** failed or cancelled, **2** biometrics unavailable.
`--check` only tests availability and never shows a prompt.

```
pnpm --filter @standin/touchid build     # swiftc -O -> packages/touchid/bin/standin-touchid (gitignored)
packages/touchid/bin/standin-touchid --check; echo $?   # 0 = Touch ID available, 2 = not
```

`requireFingerprint(reason)` (Node, `src/index.ts`) runs the binary with a 60 s timeout and resolves true only on
exit 0. On a non-Mac, or a Mac with no sensor or no GUI session, it does not pass silently: it requires the owner
to type the word `approve` at a terminal (no terminal means it fails). A timeout fails.

## Where the gate is enforced (packages/cli)

- `standin unfreeze`: fingerprint first, then guardian `unfreeze` with the owner key, then a fresh scoped agent key.
- `standin pay ... ` on a **warn** receiver: `--approve-warn` (or a typed yes) is not enough, the fingerprint must pass
  too. A **block** receiver is refused outright, nothing can approve it.

## Try it (on a Mac with Touch ID; this shows the real prompt)

```
cd ~/Documents/hackathons/near-standin
pnpm standin unfreeze          # Touch ID sheet: "Unfreeze si-agent-5289.testnet"
```

Press the sensor to approve (the agent is unfrozen and a new scoped key is saved). Cancel or use a wrong finger
and it prints `owner fingerprint not confirmed; nothing sent` and exits 5. Prompt only, no chain call:

```
packages/touchid/bin/standin-touchid "Unfreeze si-agent-5289.testnet"; echo $?     # 0 approved, 1 refused
```

## Honest limits

This is a presence check, not cryptographic binding: code running as the user could replace the binary, so the gate
sits inside the unfreeze and warn-pay flows themselves, not behind a flag file. It does not work over SSH or headless.
Keychain items with a biometry ACL need a signed binary with an entitlement, so they are not used.
