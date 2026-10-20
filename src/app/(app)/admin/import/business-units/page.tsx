import type { Metadata } from "next";
import { ImportPage } from "../import-page";

export const metadata: Metadata = { title: "Import Business Units" };

export default function Page() {
  return <ImportPage entity="business-units" />;
}
