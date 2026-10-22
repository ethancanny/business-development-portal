/**
 * Phase 6 Value Creation — barrel exports for the workspace shell,
 * tabs and shared types (mirrors how consumers import the
 * diligence components individually; there is no
 * components/diligence/index.ts, so this barrel is additive
 * convenience only).
 */

export { default as VcWorkspace } from "@/components/valuecreation/VcWorkspace";
export { default as InitiativesTab } from "@/components/valuecreation/InitiativesTab";
export { default as TimelineTab } from "@/components/valuecreation/TimelineTab";
export { default as MatrixTab } from "@/components/valuecreation/MatrixTab";
export { default as PlaybooksTab } from "@/components/valuecreation/PlaybooksTab";
export { default as TreesTab } from "@/components/valuecreation/TreesTab";
export { default as ScenariosTab } from "@/components/valuecreation/ScenariosTab";
export { default as ProcessMapsTab } from "@/components/valuecreation/ProcessMapsTab";
export { default as AddonsTab } from "@/components/valuecreation/AddonsTab";
export { default as OrgTab } from "@/components/valuecreation/OrgTab";
export { default as TargetsTab } from "@/components/valuecreation/TargetsTab";
export { default as ExitTab } from "@/components/valuecreation/ExitTab";
export { default as CompanyPicker } from "@/components/valuecreation/CompanyPicker";
export * from "@/components/valuecreation/types";
