"use client";

import { useCallback, useEffect, useState } from "react";

type NetworkResponse = {
  healthy: boolean;
  slot?: number;
  checkedAt?: string;
  error?: string;
};

export function NetworkStatus() {
  const [network, setNetwork] = useState<NetworkResponse>();
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/network", { cache: "no-store" });
      setNetwork(await response.json());
    } catch {
      setNetwork({ healthy: false, error: "Could not reach the network check." });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <button className="network-status" type="button" onClick={refresh} disabled={isLoading} title="Refresh Cookie Chain status">
      <i className={network?.healthy ? "online" : "offline"} />
      <span>{isLoading ? "Checking network…" : network?.healthy ? `Live · slot ${network.slot?.toLocaleString()}` : "RPC unavailable"}</span>
    </button>
  );
}
