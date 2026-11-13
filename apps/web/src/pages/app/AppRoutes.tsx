import { Navigate, Route, Routes } from "react-router";
import { StandinProvider } from "@/data/useStandin";
import { AppShell } from "@/components/app/shell/AppShell";
import OverviewPage from "./OverviewPage";
import TripsPage from "./TripsPage";
import TripDetailPage from "./TripDetailPage";
import DecoysPage from "./DecoysPage";
import SessionsPage from "./SessionsPage";
import BlocklistPage from "./BlocklistPage";
import BenchPage from "./BenchPage";

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
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AppShell>
    </StandinProvider>
  );
}
