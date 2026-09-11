import { useEffect, useState } from "react";
import { Landing } from "./components/Landing";
import { Dashboard } from "./components/Dashboard";

// Tiny hash router — no dependency. `#/` → landing, `#/app` → operator dashboard.
function useHash(): string {
  const [h, setH] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const on = () => setH(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  return hash.startsWith("#/app") ? <Dashboard /> : <Landing />;
}
