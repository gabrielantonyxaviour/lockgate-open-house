import Overview from "../pages/Overview";
import Platforms, { PlatformDetail } from "../pages/Platforms";
import Positions from "../pages/Positions";
import Exit from "../pages/Exit";
import Activity, { AdvanceDetail } from "../pages/Activity";
import { Issuer, Operations } from "../pages/Workspaces";
import Capital from "../pages/Capital";
import Approvals from "../pages/Approvals";
import { Onboarding } from "../pages/Onboarding";
import { Integration } from "../pages/Integration";
import { Settings } from "../pages/Settings";
import { Empty } from "./primitives";
import type { Address } from "viem";
import { useApp } from "./context";
import { RefreshCw } from "lucide-react";
import { NetworkUnavailable } from "./NetworkUnavailable";
import { go } from "./router";
import PlatformCreate from "../pages/PlatformCreate";
import PublicHome from "../pages/PublicHome";
import Welcome from "../pages/Welcome";
import JourneyStart from "../pages/JourneyStart";
import Judge from "../pages/Judge";
export function AppRoutes({
  route,
  account,
  networkId,
  onSepolia,
  onDisconnect,
}: {
  route: string;
  account?: Address;
  networkId: number;
  onSepolia: () => void;
  onDisconnect: () => void;
}) {
  const { snapshot, loading, refresh } = useApp();
  const [path, query = ""] = route.split("?");
  const segments = path.split("/").filter(Boolean);
  if (networkId === 42161) return <NetworkUnavailable onSepolia={onSepolia} />;
  if (path === "/") return <PublicHome />;
  if (path === "/choose") return account ? <Welcome /> : <PublicHome />;
  if (path === "/start/investor" || path === "/start/issuer")
    return <JourneyStart role={path.endsWith("issuer") ? "issuer" : "investor"} />;
  if (path === "/judge") return <Judge />;
  const utility = ["/onboarding", "/integration", "/settings", "/approvals"].includes(path);
  if (!snapshot && !utility)
    return loading ? (
      <div className="loading-state" role="status">
        <RefreshCw size={22} className="spin" />
        <h1>Reading your workspace.</h1>
        <p>Fetching balances, terms, and permissions from Arbitrum Sepolia.</p>
      </div>
    ) : (
      <Empty
        title="Chain data unavailable"
        action={
          <button className="button" onClick={refresh}>
            Retry connection
          </button>
        }
      >
        Check your connection and try again. Your wallet and positions are unchanged.
      </Empty>
    );
  let content;
  switch (segments[0]) {
    case "create":
      content = <PlatformCreate />;
      break;
    case "overview":
      content = <Overview />;
      break;
    case "platforms":
      content = <Platforms />;
      break;
    case "platform":
      content = <PlatformDetail key={path} address={segments[1] || ""} />;
      break;
    case "positions":
      content = <Positions />;
      break;
    case "exit":
      content = <Exit key={route} address={segments[1] || ""} params={new URLSearchParams(query)} />;
      break;
    case "activity":
      content = <Activity />;
      break;
    case "advance":
      content = <AdvanceDetail id={segments[1] || ""} />;
      break;
    case "issuer":
      content = <Issuer />;
      break;
    case "operations":
      content = <Operations />;
      break;
    case "capital":
      content = <Capital />;
      break;
    case "approvals":
      content = <Approvals />;
      break;
    case "onboarding":
      content = <Onboarding />;
      break;
    case "integration":
      content = <Integration />;
      break;
    case "settings":
      content = (
        <Settings
          account={account}
          onGuide={() => go("/judge")}
          onDisconnect={() => {
            onDisconnect();
          }}
        />
      );
      break;
    default:
      content = (
        <Empty
          title="Screen not found"
          action={
            <a className="button" href="#/overview">
              Return to overview
            </a>
          }
        >
          Choose a screen from the navigation.
        </Empty>
      );
  }
  return content;
}
