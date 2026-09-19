import type { Metadata } from "next";
import { config } from "@/lib/config";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Console",
  description: "HR user management and delegated client-admin group management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
          <a
            href={`${config.keycloakPublicUrl}/admin/${encodeURIComponent(config.realm)}/console/`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Open Keycloak Admin Console
          </a>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
