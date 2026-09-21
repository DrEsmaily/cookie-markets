"use client";

import { useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";

type ProtocolResponse = {
  deployed: boolean;
  collateralMint?: string;
  error?: string;
};

export function ProtocolStatus() {
  const [protocol, setProtocol] = useState<ProtocolResponse>();

  useEffect(() => {
    void fetch("/api/protocol", { cache: "no-store" })
      .then((response) => readApiResponse<ProtocolResponse>(response, "Protocol status returned an unreadable response."))
      .then(setProtocol)
      .catch(() => setProtocol({ deployed: false, error: "Protocol check failed." }));
  }, []);

  return (
    <span
      className={protocol?.deployed ? "protocol-status deployed" : "protocol-status"}
      title={
        protocol?.deployed
          ? `Approved collateral: ${protocol.collateralMint}`
          : protocol?.error ?? "Program has not been deployed on Cookie Chain."
      }
    >
      {protocol?.deployed ? "Protocol live" : protocol ? "Protocol pending" : "Checking protocol…"}
    </span>
  );
}
