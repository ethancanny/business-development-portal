import { redirect } from "next/navigation";

/**
 * The Data Dictionary page was removed at Ethan's direction
 * (Oct 24, 2026). Direct visits land back on Settings. The generated
 * dictionary service remains available to the Data Explorer.
 */
export default function SettingsDataDictionaryPage() {
  redirect("/settings");
}
