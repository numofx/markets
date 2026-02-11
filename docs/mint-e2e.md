# Wallet-delay dirty-pool guard

## Test name

Wallet-delay dirty-pool guard

## Preconditions

- Pool is clean (`pendingBaseDelta = 0`, `pendingFyDelta = 0`).
- Second wallet (wallet B) is funded and can submit a transaction.
- Browser console logs are enabled.

## Steps

1. In wallet A, open Add Liquidity and enter valid amounts.
2. Click `Add liquidity` and wait until simulation is done and wallet confirmation is open.
3. Do not confirm yet; wait 60 seconds.
4. From wallet B, submit a transaction that dirties pool balances (creates pending delta).
5. Return to wallet A and confirm the pending wallet transaction.

## Expected

- The app hard-blocks before mint write if pending deltas are non-zero.
- UI shows pending-delta failure and `Recover / Sync pool` call-to-action.
- No mint transaction is sent from wallet A.

## Artifacts to capture

- Screenshot of UI showing the pending-delta block + `Recover / Sync pool`.
- Console log line(s) showing the pre-write pending-balance guard (`assertPoolMintableState` path).
