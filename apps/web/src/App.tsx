import { Route, Routes } from "react-router";
import LandingPage from "@/pages/landing/LandingPage";
import AppRoutes from "@/pages/app/AppRoutes";
import LabPage from "@/pages/lab/LabPage";
import VerifyPage from "@/pages/verify/VerifyPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/*" element={<AppRoutes />} />
      <Route path="/lab" element={<LabPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
