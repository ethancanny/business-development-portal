import MyCompany from "@/components/portmgmt/MyCompany";

/**
 * Scoped portfolio-company portal (Phase 9). AppShell bypasses the
 * platform chrome for /my-company (mirroring /room/*); MyCompany
 * renders its own minimal branded shell.
 */
export default function MyCompanyPage() {
  return <MyCompany />;
}
