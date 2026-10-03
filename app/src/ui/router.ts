import { useEffect, useState } from "react";
export function useRoute() {
  const read = () => location.hash.slice(1) || "/overview";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const change = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return route;
}
export function go(path: string) {
  location.hash = path;
}
