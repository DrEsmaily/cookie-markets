import { ResolverSetup } from "@/components/resolver-setup";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function ResolverAdminPage() {
  return <main><SiteHeader backHref="/" /><ResolverSetup /><SiteFooter /></main>;
}
