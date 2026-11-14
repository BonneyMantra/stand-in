import { useCallback, useEffect, useRef, useState } from "react";
import type { NearWalletBase } from "@hot-labs/near-connect";
import { getConnector, readableError } from "@/lib/wallet/connector";

export type WalletStatus = "restoring" | "disconnected" | "connecting" | "connected";

export interface WalletInfo {
  status: WalletStatus;
  accountId: string | null;
  walletName: string | null;
  walletIcon: string | null;
  error: string | null;
}

const IDLE: WalletInfo = { status: "disconnected", accountId: null, walletName: null, walletIcon: null, error: null };
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** NEAR Connect session for the owner console: connect, disconnect, and restore the session on reload. */
export function useNearWallet() {
  const [info, setInfo] = useState<WalletInfo>({ ...IDLE, status: "restoring" });
  const walletRef = useRef<NearWalletBase | null>(null);

  const adopt = useCallback((wallet: NearWalletBase, accountId: string) => {
    walletRef.current = wallet;
    setInfo({ status: "connected", accountId, walletName: wallet.manifest.name, walletIcon: wallet.manifest.icon ?? null, error: null });
  }, []);

  useEffect(() => {
    const c = getConnector();
    let alive = true;
    const onIn = (t: { wallet: NearWalletBase; accounts: { accountId: string }[] }) => {
      if (alive && t.accounts[0]) adopt(t.wallet, t.accounts[0].accountId);
    };
    const onOut = () => {
      walletRef.current = null;
      if (alive) setInfo(IDLE);
    };
    c.on("wallet:signIn", onIn);
    c.on("wallet:signOut", onOut);
    (async () => {
      await c.whenManifestLoaded.catch(() => undefined);
      // Debug-manifest wallets register a moment after the manifest; give them that moment before giving up.
      for (let attempt = 0; attempt < 3; attempt++) {
        await tick(attempt === 0 ? 0 : 400);
        try {
          const { wallet, accounts } = await c.getConnectedWallet();
          if (alive && accounts[0]) adopt(wallet, accounts[0].accountId);
          return;
        } catch (e) {
          if (!/No wallet selected/.test(String((e as Error)?.message)) || !localStorage.getItem("selected-wallet")) break;
        }
      }
      if (alive) setInfo((s) => (s.status === "restoring" ? IDLE : s));
    })();
    return () => {
      alive = false;
      c.off("wallet:signIn", onIn);
      c.off("wallet:signOut", onOut);
    };
  }, [adopt]);

  const connect = useCallback(async () => {
    setInfo((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const wallet = await getConnector().connect();
      const accounts = await wallet.getAccounts();
      if (accounts[0]) adopt(wallet, accounts[0].accountId);
      else setInfo({ ...IDLE, error: "The wallet connected but returned no account." });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Closing the wallet picker is a choice, not an error.
      const text = readableError(e);
      // Not connected yet, so the generic "disconnect and connect again" hint does not apply here.
      setInfo({ ...IDLE, error: msg === "User rejected" ? null : /rejected in the wallet/.test(text) ? "The sign-in was rejected in the wallet. Nothing was shared or sent." : text });
    }
  }, [adopt]);

  const disconnect = useCallback(async () => {
    const c = getConnector();
    try {
      await c.disconnect(walletRef.current ?? undefined);
    } catch {
      localStorage.removeItem("selected-wallet");
    }
    walletRef.current = null;
    setInfo(IDLE);
  }, []);

  return { ...info, wallet: walletRef, connect, disconnect };
}
