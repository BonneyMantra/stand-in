import { createContext, useContext, type ReactNode } from "react";
import { useNearWallet, type NearWallet } from "./useNearWallet";

const Ctx = createContext<NearWallet | null>(null);

/** One NEAR Connect session for every dashboard page: My account, the owner console and the shell read the same wallet. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const w = useNearWallet();
  return <Ctx.Provider value={w}>{children}</Ctx.Provider>;
}

export function useWallet(): NearWallet {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
