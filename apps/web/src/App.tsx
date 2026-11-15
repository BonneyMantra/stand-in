import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import LandingPage from "@/pages/landing/LandingPage";
import NotFoundPage from "@/pages/NotFoundPage";
import { LoadBoundary } from "@/components/lab/LoadBoundary";

// The landing page ships alone: the dashboard (with NEAR Connect), the lab and /verify load when their route opens. A chunk a
// redeploy removed reloads the page once (lib/staleChunk.ts); a second failure shows the boundary's reload notice.
const AppRoutes = lazy(() => import("@/pages/app/AppRoutes"));
const LabPage = lazy(() => import("@/pages/lab/LabPage"));
const VerifyPage = lazy(() => import("@/pages/verify/VerifyPage"));

function Loading() {
  return <div className="min-h-dvh bg-ink-950" role="status" aria-label="Loading" />;
}

const page = (what: string, el: ReactNode) => (
  <LoadBoundary what={what}>
    <Suspense fallback={<Loading />}>{el}</Suspense>
  </LoadBoundary>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/*" element={page("The dashboard", <AppRoutes />)} />
      <Route path="/lab" element={page("The lab", <LabPage />)} />
      <Route path="/verify" element={page("The claim checker", <VerifyPage />)} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
