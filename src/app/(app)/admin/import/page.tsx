import type { Metadata } from "next";
import { ImportPage } from "./import-page";

export const metadata: Metadata = { title: "Import employees" };

export default function Page() {
  return <ImportPage entity="employees" />;
}
