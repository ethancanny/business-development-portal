import BdHub from "@/components/hubs/BdHub";

/**
 * Business Development hub (navigation restructure): the old card
 * grid is replaced by live summary sections — Pipeline, Market
 * Intel, Activity, Tasks & Follow-ups — each backed by a compact
 * /api/platform/hubs/* summary endpoint. Directory and Audit Trail
 * are no longer tiles here; they live in the main navigation.
 * The hub itself is the client component in components/hubs/BdHub.
 */
export default function BusinessDevelopmentPage() {
  return <BdHub />;
}
