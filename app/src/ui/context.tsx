import { createContext, useContext } from "react";
import type { Address } from "viem";
import type { Action, Snapshot } from "../chain/model";
export interface AppContextValue {
  snapshot: Snapshot | null;
  account?: Address;
  loading: boolean;
  error: string;
  preview: boolean;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  review: (action: Action, title: string, description: string) => void;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
