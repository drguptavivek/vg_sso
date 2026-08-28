import Link from "next/link";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  ["Fetch EHRMS details", "Enter your employee ID and check the masked email address and mobile number."],
  ["Create the account", "Confirm the contact details and select Create account."],
  ["Open the setup email", "Use the secure link sent to your EHRMS email. The message contains your username."],
  ["Verify and choose a password", "Verify your email address, then create a password that meets the displayed rules."],
  ["Enrol MFA", "Scan the QR code or use the setup key in your authenticator app."],
  ["Save recovery codes", "Download the recovery codes and keep them somewhere safe and private."],
  ["Complete first sign-in", "Sign in with your new credentials and verify the EHRMS mobile number by SMS OTP."],
] as const;

export const metadata = { title: "SSO registration help", robots: { index: false, follow: false } };

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader>
          <CardTitle>{config.realm} SSO registration help</CardTitle>
          <CardDescription>Complete the emailed setup flow before attempting your first sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {STEPS.map(([title, description], index) => (
              <li className="flex gap-3" key={title}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div>
              </li>
            ))}
          </ol>
          <p className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            Please contact <strong>Computer Facility Tech Support</strong> if registration or account setup fails.
          </p>
        </CardContent>
        <CardFooter className="flex-col gap-3 sm:flex-row">
          <Button asChild className="w-full"><Link href="/register">Start self-registration</Link></Button>
          <Button asChild variant="outline" className="w-full"><Link href="/">Back to SSO home</Link></Button>
        </CardFooter>
      </Card>
    </main>
  );
}
