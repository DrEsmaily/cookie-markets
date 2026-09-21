import { ResolverSetup } from "@/components/resolver-setup";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const dynamic = "force-dynamic";

export default function ResolverAdminPage() {
  return <main><SiteHeader backHref="/" /><ResolverSetup /><SiteFooter /></main>;
}
