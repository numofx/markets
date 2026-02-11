"use client";

import { useConnectWallet, useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { Copy, LogOut, Settings, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { useSoftWalletDisconnect } from "@/lib/useSoftWalletDisconnect";

function readWalletMeta(wallet: unknown) {
  if (!wallet || typeof wallet !== "object") {
    return { connectorType: undefined, walletClientType: undefined };
  }
  const maybe = wallet as { connectorType?: unknown; walletClientType?: unknown };
  return {
    connectorType: typeof maybe.connectorType === "string" ? maybe.connectorType : undefined,
    walletClientType:
      typeof maybe.walletClientType === "string" ? maybe.walletClientType : undefined,
  };
}

function getDisconnectNote(wallet: unknown): string | null {
  void wallet;
  return null;
}

function getDisconnectDisabledReason(wallet: unknown): string | null {
  return wallet ? null : "Disconnect unavailable.";
}

function shouldAttemptProgrammaticDisconnect(wallet: unknown) {
  if (!wallet || typeof wallet !== "object") {
    return false;
  }
  const { connectorType, walletClientType } = readWalletMeta(wallet);
  const isInjected = connectorType === "injected";
  const isUniswap = walletClientType?.toLowerCase().includes("uniswap") ?? false;
  return (
    !(isInjected || isUniswap) &&
    typeof (wallet as { disconnect?: unknown }).disconnect === "function"
  );
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable.");
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.top = "0";
  input.style.left = "0";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  const success = document.execCommand("copy");
  document.body.removeChild(input);
  if (!success) {
    throw new Error("Clipboard unavailable.");
  }
}

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
  busy: boolean;
  onConnectWallet: () => void;
};

type SignedInPanelProps = {
  addr: string | null;
  busy: boolean;
  disconnectDisabledReason: string | null;
  disconnectNote: string | null;
  onCopyAddress: () => Promise<void>;
  onChangeWallet: () => void;
  onDisconnectWallet: () => Promise<void>;
};

type ConnectedWalletPanelProps = {
  addr: string;
  busy: boolean;
  disconnectDisabledReason: string | null;
  disconnectNote: string | null;
  canLoginOrLink: boolean;
  onLoginOrLink: () => Promise<void>;
  onCopyAddress: () => Promise<void>;
  onChangeWallet: () => void;
  onDisconnectWallet: () => Promise<void>;
};

function MenuItem(props: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white/90 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={props.disabled}
      onClick={() => void props.onClick()}
      type="button"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10">
        {props.icon}
      </span>
      <span className="font-medium text-sm">{props.label}</span>
    </button>
  );
}

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

function ConnectedWalletPanel({
  addr,
  busy,
  disconnectDisabledReason,
  disconnectNote,
  canLoginOrLink,
  onLoginOrLink,
  onCopyAddress,
  onChangeWallet,
  onDisconnectWallet,
}: ConnectedWalletPanelProps) {
  const disconnectDisabled = Boolean(disconnectDisabledReason);
  return (
    <div>
      <div className="px-3 pb-2 text-white/70 text-xs">Wallet connected</div>
      <div className="break-all px-3 pb-3 font-semibold text-sm text-white">{addr}</div>
      <div className="h-px bg-white/10" />
      <div className="py-2">
        {canLoginOrLink ? (
          <MenuItem
            disabled={busy}
            icon={<Settings className="h-4 w-4 text-white/70" />}
            label="Continue"
            onClick={onLoginOrLink}
          />
        ) : null}
        <MenuItem
          disabled={busy}
          icon={<Copy className="h-4 w-4 text-white/70" />}
          label="Copy address"
          onClick={onCopyAddress}
        />
        <MenuItem
          disabled={busy}
          icon={<Wallet className="h-4 w-4 text-white/70" />}
          label="Change wallet"
          onClick={async () => onChangeWallet()}
        />
        <MenuItem
          disabled={busy || disconnectDisabled}
          icon={<LogOut className="h-4 w-4 text-white/70" />}
          label="Disconnect"
          onClick={onDisconnectWallet}
        />
        {disconnectDisabledReason ? (
          <div className="px-3 pt-2 text-white/50 text-xs">{disconnectDisabledReason}</div>
        ) : null}
        {disconnectNote ? (
          <div className="px-3 pt-2 text-white/50 text-xs">{disconnectNote}</div>
        ) : null}
      </div>
    </div>
  );
}

function WalletSection({ addr, busy, onConnectWallet }: WalletSectionProps) {
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
      {addr ? <div className="mt-2 text-numo-muted text-xs">Connected: {addr}</div> : null}
      {busy ? <div className="mt-2 text-numo-muted text-xs">Awaiting wallet…</div> : null}
    </div>
  );
}

function SignedInPanel({
  addr,
  busy,
  disconnectDisabledReason,
  disconnectNote,
  onCopyAddress,
  onChangeWallet,
  onDisconnectWallet,
}: SignedInPanelProps) {
  const disconnectDisabled = Boolean(disconnectDisabledReason);
  return (
    <div>
      <div className="px-3 pb-2 text-white/70 text-xs">Wallet</div>
      <div className="break-all px-3 pb-3 font-semibold text-sm text-white">{addr ?? "—"}</div>
      <div className="h-px bg-white/10" />
      <div className="py-2">
        <MenuItem
          disabled={busy}
          icon={<Copy className="h-4 w-4 text-white/70" />}
          label="Copy address"
          onClick={onCopyAddress}
        />
        <MenuItem
          disabled={busy}
          icon={<Wallet className="h-4 w-4 text-white/70" />}
          label="Change wallet"
          onClick={async () => onChangeWallet()}
        />
        <MenuItem
          disabled={busy || disconnectDisabled}
          icon={<LogOut className="h-4 w-4 text-white/70" />}
          label="Disconnect"
          onClick={onDisconnectWallet}
        />
        {disconnectDisabledReason ? (
          <div className="px-3 pt-2 text-white/50 text-xs">{disconnectDisabledReason}</div>
        ) : null}
        {disconnectNote ? (
          <div className="px-3 pt-2 text-white/50 text-xs">{disconnectNote}</div>
        ) : null}
      </div>
    </div>
  );
}

function ConnectPopoverContent(props: {
  addr: string | null;
  authenticated: boolean;
  busy: boolean;
  canLoginOrLink: boolean;
  code: string;
  codeSent: boolean;
  disconnectDisabledReason: string | null;
  disconnectNote: string | null;
  email: string;
  onCopyAddress: () => Promise<void>;
  onChangeWallet: () => void;
  onConnectWallet: () => void;
  onDisconnectWallet: () => Promise<void>;
  onLoginOrLink: () => Promise<void>;
  onSendCode: () => Promise<void>;
  onVerifyCode: () => Promise<void>;
  setCode: (value: string) => void;
  setEmail: (value: string) => void;
}) {
  if (props.authenticated) {
    return (
      <SignedInPanel
        addr={props.addr}
        busy={props.busy}
        disconnectDisabledReason={props.disconnectDisabledReason}
        disconnectNote={props.disconnectNote}
        onChangeWallet={props.onChangeWallet}
        onCopyAddress={props.onCopyAddress}
        onDisconnectWallet={props.onDisconnectWallet}
      />
    );
  }

  if (props.addr) {
    return (
      <ConnectedWalletPanel
        addr={props.addr}
        busy={props.busy}
        canLoginOrLink={props.canLoginOrLink}
        disconnectDisabledReason={props.disconnectDisabledReason}
        disconnectNote={props.disconnectNote}
        onChangeWallet={props.onChangeWallet}
        onCopyAddress={props.onCopyAddress}
        onDisconnectWallet={props.onDisconnectWallet}
        onLoginOrLink={props.onLoginOrLink}
      />
    );
  }

  return (
    <>
      <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">Sign in</div>
      <div className="mt-3 space-y-3">
        <EmailSection
          busy={props.busy}
          code={props.code}
          codeSent={props.codeSent}
          email={props.email}
          onSendCode={props.onSendCode}
          onVerifyCode={props.onVerifyCode}
          setCode={props.setCode}
          setEmail={props.setEmail}
        />
        <WalletSection
          addr={props.addr}
          busy={props.busy}
          onConnectWallet={props.onConnectWallet}
        />
      </div>
    </>
  );
}

export function PrivyConnectPill() {
  const { ready, authenticated } = usePrivy();
  const { wallet } = usePrivyWalletClient();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { setSoftDisconnected } = useSoftWalletDisconnect();
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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authenticated) {
      setEmail("");
      setCode("");
      setCodeSent(false);
      setError(null);
      setNotice(null);
    }
  }, [authenticated]);

  if (!ready) {
    return null;
  }

  const addr = wallet?.address ?? null;
  const label = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Connect";

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

  const handleDisconnectWallet = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!wallet) {
        return;
      }
      // App-level "disconnect" is always supported. For injected wallets, we avoid calling
      // disconnect() because many extensions can't revoke site permissions programmatically.
      setSoftDisconnected(true);
      if (shouldAttemptProgrammaticDisconnect(wallet)) {
        const reason = getDisconnectDisabledReason(wallet);
        if (reason) {
          setError(reason);
          return;
        }
        await Promise.resolve(wallet.disconnect());
      }
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disconnect wallet.");
    } finally {
      setBusy(false);
    }
  };

  const handleLoginOrLink = async () => {
    if (!wallet || typeof wallet.loginOrLink !== "function") {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await wallet.loginOrLink();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in with wallet.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!addr) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await copyText(addr);
      setNotice("Copied address.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to copy address.");
    } finally {
      setBusy(false);
    }
  };

  void addr;

  const disconnectDisabledReason = getDisconnectDisabledReason(wallet);
  const disconnectNote = getDisconnectNote(wallet);
  const canLoginOrLink = Boolean(wallet && typeof wallet.loginOrLink === "function");
  const popoverContent: ReactNode = (
    <ConnectPopoverContent
      addr={addr}
      authenticated={authenticated}
      busy={busy}
      canLoginOrLink={canLoginOrLink}
      code={code}
      codeSent={codeSent}
      disconnectDisabledReason={disconnectDisabledReason}
      disconnectNote={disconnectNote}
      email={email}
      onChangeWallet={() => {
        setSoftDisconnected(false);
        connectWallet();
      }}
      onConnectWallet={() => {
        setSoftDisconnected(false);
        connectWallet();
      }}
      onCopyAddress={handleCopyAddress}
      onDisconnectWallet={handleDisconnectWallet}
      onLoginOrLink={handleLoginOrLink}
      onSendCode={handleSendCode}
      onVerifyCode={handleVerifyCode}
      setCode={setCode}
      setEmail={setEmail}
    />
  );

  const handlePillClick = () => {
    if (!addr) {
      // One click should go straight to the wallet picker.
      setIsOpen(false);
      setSoftDisconnected(false);
      connectWallet();
      return;
    }
    setIsOpen((open) => !open);
  };

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="flex items-center gap-3 rounded-full border border-white/10 bg-neutral-900/90 px-4 py-2.5 font-semibold text-base text-white shadow-lg backdrop-blur transition hover:bg-neutral-900"
        onClick={handlePillClick}
        type="button"
      >
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 shadow-sm ring-1 ring-white/10">
          <Wallet aria-hidden className="h-5 w-5 text-white/90" />
        </span>
        <span>{label}</span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-3xl border border-white/10 bg-neutral-950/95 p-2 text-sm shadow-2xl backdrop-blur">
          {popoverContent}
          {notice ? <div className="px-3 pb-2 text-emerald-200 text-xs">{notice}</div> : null}
          {error ? <div className="px-3 pb-2 text-red-300 text-xs">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
