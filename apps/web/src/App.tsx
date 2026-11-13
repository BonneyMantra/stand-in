import { Route, Routes } from "react-router";
import LandingPage from "@/pages/landing/LandingPage";
import AppRoutes from "@/pages/app/AppRoutes";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/*" element={<AppRoutes />} />
    </Routes>
  );
}
