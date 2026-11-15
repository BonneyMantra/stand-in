import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { AppNotFound } from "@/pages/NotFoundPage";
import { StandinProvider } from "@/data/useStandin";
import { MyAccountProvider } from "@/data/useMyAccount";
import { WalletProvider } from "@/components/owner/WalletProvider";
import { AppShell } from "@/components/app/shell/AppShell";
import OverviewPage from "./OverviewPage";
import TripsPage from "./TripsPage";
import TripDetailPage from "./TripDetailPage";
import DecoysPage from "./DecoysPage";
import SessionsPage from "./SessionsPage";
import BlocklistPage from "./BlocklistPage";
import BenchPage from "./BenchPage";
import MyAccountPage from "./MyAccountPage";
import MyTripsPage from "./MyTripsPage";
import MyDecoysPage from "./MyDecoysPage";

// The console's panels and wallet requests load only on this route.
const OwnerPage = lazy(() => import("./OwnerPage"));

/** Old links to a recorded trip (/app/trips/<hash>) now open it under the example. */
function OldTrip() {
  const { tx } = useParams();
  return <Navigate to={`/app/example/trips/${tx ?? ""}`} replace />;
}

/**
 * /app is the signed-in owner's own account, read from chain. The recorded testnet run is the Example, under
 * /app/example, reachable but secondary.
 */
export default function AppRoutes() {
  return (
    <WalletProvider>
      <MyAccountProvider>
        <StandinProvider>
          <AppShell>
            <Routes>
              <Route index element={<MyAccountPage />} />
              <Route path="trips" element={<MyTripsPage />} />
              <Route path="trips/:tx" element={<OldTrip />} />
              <Route path="decoys" element={<MyDecoysPage />} />
              <Route path="owner" element={<Suspense fallback={null}><OwnerPage /></Suspense>} />
              <Route path="bench" element={<BenchPage />} />
              <Route path="example" element={<OverviewPage />} />
              <Route path="example/trips" element={<TripsPage />} />
              <Route path="example/trips/:tx" element={<TripDetailPage />} />
              <Route path="example/decoys" element={<DecoysPage />} />
              <Route path="example/sessions" element={<SessionsPage />} />
              <Route path="example/blocklist" element={<BlocklistPage />} />
              <Route path="sessions" element={<Navigate to="/app/example/sessions" replace />} />
              <Route path="blocklist" element={<Navigate to="/app/example/blocklist" replace />} />
              <Route path="*" element={<AppNotFound />} />
            </Routes>
          </AppShell>
        </StandinProvider>
      </MyAccountProvider>
    </WalletProvider>
  );
}
