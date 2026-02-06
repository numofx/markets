"use client";

import { useConnectWallet, useLoginWithEmail, useLogout, usePrivy } from "@privy-io/react-auth";
import { ChevronDown, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";

type EmailSectionProps = {
  busy: boolean;
  code: string;
  codeSent: boolean;
  email: string;
  onSendCode: () => Promise<void>;
  onVerifyCode: () => Promise<void>;
  setCode: (value: string) => void;
  setEmail: (value: string) => void;
};

type WalletSectionProps = {
  addr: string | null;
  authenticated: boolean;
  busy: boolean;
  onConnectWallet: () => void;
  onFinishSignIn: () => Promise<void>;
};

type SignedInPanelProps = {
  addr: string | null;
  busy: boolean;
  onSignOut: () => Promise<void>;
};

function EmailSection({
  busy,
  code,
  codeSent,
  email,
  onSendCode,
  onVerifyCode,
  setCode,
  setEmail,
}: EmailSectionProps) {
  return (
    <div className="rounded-xl border border-numo-border/60 p-3">
      <div className="font-semibold text-numo-muted text-xs">Email</div>
      <input
        className="mt-2 w-full rounded-lg border border-numo-border/60 px-3 py-2 text-numo-ink text-sm outline-none focus:border-numo-ink"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@numo.xyz"
        type="email"
        value={email}
      />
      {codeSent ? (
        <>
          <input
            className="mt-2 w-full rounded-lg border border-numo-border/60 px-3 py-2 text-numo-ink text-sm outline-none focus:border-numo-ink"
            inputMode="numeric"
            onChange={(event) => setCode(event.target.value)}
            placeholder="Enter code"
            value={code}
          />
          <button
            className="mt-2 w-full rounded-lg bg-numo-ink px-3 py-2 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || code.length === 0}
            onClick={onVerifyCode}
            type="button"
          >
            Verify code
          </button>
        </>
      ) : (
        <button
          className="mt-2 w-full rounded-lg bg-numo-ink px-3 py-2 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || email.length === 0}
          onClick={onSendCode}
          type="button"
        >
          Send code
        </button>
      )}
    </div>
  );
}

function WalletSection({
  addr,
  authenticated,
  busy,
  onConnectWallet,
  onFinishSignIn,
}: WalletSectionProps) {
  return (
    <div className="rounded-xl border border-numo-border/60 p-3">
      <div className="font-semibold text-numo-muted text-xs">Wallet</div>
      <button
        className="mt-2 w-full rounded-lg border border-numo-border px-3 py-2 font-semibold text-numo-ink text-sm"
        onClick={onConnectWallet}
        type="button"
      >
        Connect wallet
      </button>
      {!!addr && !authenticated ? (
        <button
          className="mt-2 w-full rounded-lg bg-numo-ink px-3 py-2 font-semibold text-sm text-white"
          disabled={busy}
          onClick={onFinishSignIn}
          type="button"
        >
          Finish sign-in
        </button>
      ) : null}
    </div>
  );
}

function SignedInPanel({ addr, busy, onSignOut }: SignedInPanelProps) {
  return (
    <div className="mb-3 rounded-xl border border-numo-border/60 p-3">
      <div className="font-semibold text-numo-muted text-xs">Signed in</div>
      <div className="mt-2 text-numo-ink text-sm">{addr ?? "Wallet connected"}</div>
      <button
        className="mt-2 w-full rounded-lg border border-numo-border px-3 py-2 font-semibold text-numo-ink text-sm"
        disabled={busy}
        onClick={onSignOut}
        type="button"
      >
        Sign out
      </button>
    </div>
  );
}

export function PrivyConnectPill() {
  const { ready, authenticated } = usePrivy();
  const { logout } = useLogout();
  const { wallet } = usePrivyWalletClient();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connectedWallet }) => {
      if ("loginOrLink" in connectedWallet && typeof connectedWallet.loginOrLink === "function") {
        void connectedWallet.loginOrLink();
      }
    },
  });
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated) {
      setIsOpen(false);
      setEmail("");
      setCode("");
      setCodeSent(false);
      setError(null);
    }
  }, [authenticated]);

  if (!ready) {
    return null;
  }

  const addr = wallet?.address ?? null;
  const label = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Connect wallet";

  const handleSendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCode({ email });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send code.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginWithCode({ code });
      setIsOpen(false);
      setEmail("");
      setCode("");
      setCodeSent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify code.");
    } finally {
      setBusy(false);
    }
  };

  const handleFinishSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await wallet?.loginOrLink?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to link wallet.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await logout();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign out.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-2 font-semibold text-numo-ink text-xs shadow-sm"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Wallet className="h-4 w-4 text-numo-muted" />
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 text-numo-muted" />
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-numo-border bg-white p-4 text-sm shadow-lg">
          {authenticated ? (
            <SignedInPanel addr={addr} busy={busy} onSignOut={handleSignOut} />
          ) : null}
          <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">
            Sign in
          </div>

          <div className="mt-3 space-y-3">
            <EmailSection
              busy={busy}
              code={code}
              codeSent={codeSent}
              email={email}
              onSendCode={handleSendCode}
              onVerifyCode={handleVerifyCode}
              setCode={setCode}
              setEmail={setEmail}
            />
            <WalletSection
              addr={addr}
              authenticated={authenticated}
              busy={busy}
              onConnectWallet={() => connectWallet()}
              onFinishSignIn={handleFinishSignIn}
            />
            {error ? <div className="text-red-600 text-xs">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
