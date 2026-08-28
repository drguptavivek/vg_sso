"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LookupResult {
  token: string;
  expiresAt: string;
  employeeId: string;
  maskedEmail: string;
  maskedPhone: string;
}

interface ConfirmResult {
  ok: true;
  code: "ACCOUNT_CREATED";
  username: string;
  message: string;
}

const REGISTRATION_STEPS = [
  {
    title: "Fetch your EHRMS details",
    description: "Enter your employee ID. We show a masked EHRMS email address and mobile number.",
  },
  {
    title: "Confirm and create the account",
    description: "Check that both masked contact details belong to you, then select Create account.",
  },
  {
    title: "Open the account-setup email",
    description: "Use the secure setup link sent to your EHRMS email address. The message also contains your username.",
  },
  {
    title: "Verify your email and set a password",
    description: "Follow the prompts in the setup link to verify your email address and choose a password.",
  },
  {
    title: "Set up MFA and save recovery codes",
    description: "Scan the QR code or use the setup key, then download and safely store your recovery codes.",
  },
  {
    title: "Sign in and verify your mobile",
    description: "On your first sign-in, enter the SMS OTP sent to the mobile number recorded in EHRMS.",
  },
] as const;

function RegistrationWalkthrough({ currentStep }: { currentStep: number }) {
  return (
    <Card className="lg:sticky lg:top-10">
      <CardHeader>
        <CardTitle className="text-lg">Your registration journey</CardTitle>
        <CardDescription>Complete every step before using your new SSO account.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-5">
          {REGISTRATION_STEPS.map((step, index) => {
            const stepNumber = index + 1;
            const completed = stepNumber < currentStep;
            const active = stepNumber === currentStep;

            return (
              <li className="flex gap-3" key={step.title}>
                <span
                  aria-current={active ? "step" : undefined}
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    completed
                      ? "bg-emerald-600 text-white"
                      : active
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
                        : "border bg-background text-muted-foreground"
                  }`}
                >
                  {completed ? <CheckCircle2 className="size-4" aria-hidden="true" /> : stepNumber}
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
          Keep the setup page open until email verification, password setup, MFA enrolment, and recovery-code
          generation are all complete.
        </p>
      </CardContent>
    </Card>
  );
}

async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The request could not be completed");
  return payload;
}

export function RegisterClient({ realmName }: { realmName: string }) {
  const [employeeId, setEmployeeId] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [success, setSuccess] = useState<ConfirmResult | null>(null);
  const [busy, setBusy] = useState<"lookup" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const currentStep = success ? 3 : lookup ? 2 : 1;

  function startAgain() {
    setLookup(null);
    setSuccess(null);
    setError("");
    setBusy(null);
  }

  async function fetchDetails(event: FormEvent) {
    event.preventDefault();
    setBusy("lookup");
    setError("");
    try {
      setLookup(await post<LookupResult>("/api/register/lookup", { employeeId }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "EHRMS lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDetails() {
    if (!lookup) return;
    setBusy("confirm");
    setError("");
    try {
      setSuccess(await post<ConfirmResult>("/api/register/confirm", { token: lookup.token }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Account creation failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="grid w-full max-w-5xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Card className="w-full">
          <CardHeader className="space-y-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <CardTitle className="text-xl">{realmName} SSO self-registration</CardTitle>
              <CardDescription>
                Permanent employees can create an SSO account using contact details recorded in EHRMS.
              </CardDescription>
            </div>
            <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
              Please contact <strong>Computer Facility Tech Support</strong> for any difficulties.
            </p>
          </CardHeader>
          {success ? (
            <>
              <CardContent className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div className="space-y-2">
                    <p className="font-medium">Account created</p>
                    <p className="text-sm">{success.message}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your username</p>
                <p className="mt-1 break-all font-mono text-base font-semibold">{success.username}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Open the setup email and finish email verification, password setup, MFA enrolment, and
                recovery-code generation before signing in. Your first sign-in will verify your mobile by SMS OTP.
              </p>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full">
                  <Link href="/signin">Sign in after completing email setup</Link>
                </Button>
              </CardFooter>
            </>
          ) : lookup ? (
            <>
              <CardContent className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">Confirm your EHRMS contact details</p>
                <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">Employee ID</dt>
                  <dd className="font-medium">{lookup.employeeId}</dd>
                  <dt className="text-muted-foreground">Mobile number</dt>
                  <dd className="font-medium">{lookup.maskedPhone}</dd>
                  <dt className="text-muted-foreground">Email address</dt>
                  <dd className="break-all font-medium">{lookup.maskedEmail}</dd>
                </dl>
              </div>
              <p className="text-sm text-muted-foreground">
                Continue only if both masked contact details are yours. Verification messages will be
                sent to these EHRMS contacts.
              </p>
              {error && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <p>{error}</p>
                  <p className="mt-2 text-foreground">
                    If you already have an account, sign in and use <strong>Forgot password</strong> on the login screen.
                  </p>
                </div>
              )}
              </CardContent>
              <CardFooter className="flex-col gap-3 sm:flex-row">
              <Button variant="outline" className="w-full" onClick={startAgain} disabled={busy !== null}>
                <RotateCcw aria-hidden="true" />Start again
              </Button>
              <Button className="w-full" onClick={confirmDetails} disabled={busy !== null}>
                {busy === "confirm" && <Loader2 className="animate-spin" aria-hidden="true" />}
                These are correct — create account
              </Button>
              </CardFooter>
            </>
          ) : (
            <form onSubmit={fetchDetails}>
              <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="employee-id">Employee ID</Label>
                <Input
                  id="employee-id"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  placeholder="Enter your EHRMS employee ID"
                  autoComplete="off"
                  maxLength={64}
                  required
                  autoFocus
                />
              </div>
              <p className="text-sm text-muted-foreground">
                We will show only a masked email address and the last four digits of your mobile number.
              </p>
              {error && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              </CardContent>
              <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={busy !== null || !employeeId.trim()}>
                {busy === "lookup" && <Loader2 className="animate-spin" aria-hidden="true" />}
                Fetch employee details
              </Button>
              <Button asChild variant="link" className="w-full">
                <Link href="/signin">Already registered? Sign in or reset credentials</Link>
              </Button>
              </CardFooter>
            </form>
          )}
        </Card>
        <RegistrationWalkthrough currentStep={currentStep} />
      </div>
    </main>
  );
}
