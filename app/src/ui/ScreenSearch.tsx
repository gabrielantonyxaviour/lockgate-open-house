import { useRef } from "react";
import { X, ArrowRight } from "lucide-react";
import { useDialog } from "./dialog";
import { useApp } from "./context";
import { NAV } from "./navigation";
export function ScreenSearch({
  search,
  onChange,
  onClose,
}: {
  search: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const {snapshot,account} = useApp();
  const matching = snapshot?.account?.toLowerCase() === account?.toLowerCase() && Boolean(account);
  const allowed = (group:string,path:string) => group === "investor" || path === "/settings" || path === "/integration" || (matching && ((group === "issuer" || path === "/onboarding") && Boolean(snapshot?.roles.issuerPlatforms.length) || group === "partner" && Boolean(snapshot?.roles.partnerVaults.length) || group === "operations" && Boolean(snapshot?.roles.operator)));
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, onClose);
  const found = NAV.filter((n) => allowed(n.group,n.path) && n.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        ref={ref}
        tabIndex={-1}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Find a screen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <input
            value={search}
            placeholder="Find a screen…"
            onChange={(e) => onChange(e.target.value)}
            aria-label="Search screens"
          />
          <button className="icon-button" onClick={onClose} aria-label="Close search">
            <X size={16} />
          </button>
        </div>
        <div className="search-results">
          {found.map((n) => (
            <a key={n.path} href={`#${n.path}`} onClick={onClose}>
              <n.icon size={16} />
              {n.label}
              <ArrowRight size={14} />
            </a>
          ))}
          {!found.length && <p className="muted">No matching screens.</p>}
        </div>
      </section>
    </div>
  );
}
