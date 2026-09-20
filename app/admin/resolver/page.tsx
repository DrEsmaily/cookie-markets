import Link from "next/link";
import { ResolverSetup } from "@/components/resolver-setup";

export default function ResolverAdminPage() {
  return <main><nav><Link className="brand" href="/">cookie<span>markets</span></Link></nav><ResolverSetup /></main>;
}
