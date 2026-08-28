import type { Metadata } from "next";
import { RegisterClient } from "./RegisterClient";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "EHRMS self-registration",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterClient realmName={config.realm} />;
}
