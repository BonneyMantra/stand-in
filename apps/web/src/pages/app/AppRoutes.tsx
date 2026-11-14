import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { AppNotFound } from "@/pages/NotFoundPage";
import { StandinProvider } from "@/data/useStandin";
import { AppShell } from "@/components/app/shell/AppShell";
import OverviewPage from "./OverviewPage";
import TripsPage from "./TripsPage";
import TripDetailPage from "./TripDetailPage";
import DecoysPage from "./DecoysPage";
import SessionsPage from "./SessionsPage";
import BlocklistPage from "./BlocklistPage";
import BenchPage from "./BenchPage";

// Wallet code (NEAR Connect) loads only on this route; the other dashboard pages stay as they were.
const OwnerPage = lazy(() => import("./OwnerPage"));

export default function AppRoutes() {
  return (
    <StandinProvider>
      <AppShell>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="trips/:tx" element={<TripDetailPage />} />
          <Route path="decoys" element={<DecoysPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="blocklist" element={<BlocklistPage />} />
          <Route path="bench" element={<BenchPage />} />
          <Route path="owner" element={<Suspense fallback={null}><OwnerPage /></Suspense>} />
          <Route path="*" element={<AppNotFound />} />
        </Routes>
      </AppShell>
    </StandinProvider>
  );
}
