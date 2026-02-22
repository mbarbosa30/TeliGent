import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BotConfig } from "@shared/schema";

interface BotContextValue {
  bots: BotConfig[];
  isLoading: boolean;
  selectedBotId: number | null;
  selectedBot: BotConfig | undefined;
  selectBot: (id: number) => void;
}

const BotContext = createContext<BotContextValue | null>(null);

const STORAGE_KEY = "contextbot_selected_bot";

export function BotProvider({ children }: { children: React.ReactNode }) {
  const { data: bots = [], isLoading } = useQuery<BotConfig[]>({
    queryKey: ["/api/bots"],
  });

  const [rawSelectedId, setRawSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored) : null;
  });

  const selectedBotId = useMemo(() => {
    if (isLoading) return rawSelectedId;
    if (bots.length === 0) return null;
    const valid = bots.find((b) => b.id === rawSelectedId);
    return valid ? rawSelectedId : bots[0].id;
  }, [bots, isLoading, rawSelectedId]);

  useEffect(() => {
    if (selectedBotId !== rawSelectedId) {
      setRawSelectedId(selectedBotId);
    }
    if (selectedBotId !== null) {
      localStorage.setItem(STORAGE_KEY, String(selectedBotId));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedBotId, rawSelectedId]);

  const selectBot = useCallback((id: number) => {
    setRawSelectedId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const selectedBot = bots.find((b) => b.id === selectedBotId);

  return (
    <BotContext.Provider value={{ bots, isLoading, selectedBotId, selectedBot, selectBot }}>
      {children}
    </BotContext.Provider>
  );
}

export function useBot() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error("useBot must be used within BotProvider");
  return ctx;
}
