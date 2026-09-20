import Link from "next/link";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";

export function SiteFooter() {
  return <footer className="site-footer">
    <div><Link className="brand" href="/">Cookie<span>Markets</span></Link><p>Clear crypto prediction markets, settled on Cookie Chain.</p></div>
    <div className="footer-links"><Link href="/create">Create market</Link><a href={COOKIE_CHAIN.explorerUrl} target="_blank" rel="noreferrer">Cookie Chain explorer ↗</a></div>
    <p className="copyright">© {new Date().getUTCFullYear()} DrEsmaily. Built for Cookie Chain.</p>
  </footer>;
}
