# SUMMARY

One engine proposal was executed on local Anvil, chain 31337, block 73. The vault funded the signed fee. The sim, the engine, and the on-chain curve return the same bps and fee for the 600-second window, at idle and at full utilization. 0 divergences. 0 integration breaks. The chain was not reset and was not warped.

# Agreements

600-second window: sim 100 bps, engine 100 bps, chain 100 bps; fees 100000000, 100000000, 100000000.
Full utilization: sim 149 bps, engine 149 bps, chain 149 bps.
Fee on nav 1000001 at 100 bps: sim 10001, engine 10001, chain 10001 (all ceil).
Vault fee 100000000 equals the signed engine fee 100000000.
Vault principal 9900000000 equals the signed payout 9900000000.
Idle fell from 80000000000 to 70100000000, then repay left it at 80100000000.
Lockgate's token balance stayed 0.

# Divergences

None.

# Command

```
cd lockgate/repo/e2e
npm run compare
```
