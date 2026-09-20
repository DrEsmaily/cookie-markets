import Link from "next/link";
import { NetworkStatus } from "@/components/network-status";
import { WalletButton } from "@/components/wallet-button";

export function SiteHeader({ backHref, backLabel = "All markets", compact = false }: { backHref?: string; backLabel?: string; compact?: boolean }) {
  return <nav className={compact ? "site-nav compact" : "site-nav"}>
    <Link className="brand" href="/" aria-label="CookieMarkets home">Cookie<span>Markets</span></Link>
    {backHref ? <Link className="back-link" href={backHref}>← {backLabel}</Link> : <Link className="create-link" href="/create"><span>＋</span> Create market</Link>}
    {!compact ? <div className="header-actions"><NetworkStatus /><WalletButton /></div> : null}
  </nav>;
}
