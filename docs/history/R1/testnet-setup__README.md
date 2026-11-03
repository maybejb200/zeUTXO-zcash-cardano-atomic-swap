# Authorized public testnet setup

The user authorizes dedicated test-only wallets, free tokens and transactions on Cardano Preview and Zcash Testnet. No mainnet, real funds, paid services or existing personal wallets. Keep keys local. Stop active work with 5% included account usage left; the separate transaction resource reserve is 20%.

Cardano Preview correction (September 9, resumed work): the old funded wallet's recorded key envelope was found to be empty. The earlier persistence claim was incorrect. Its public record is preserved as cardano-preview-v1-unusable.json. Replacement wallet v2 passes encrypted-key round trip and separate-process recovery, but funding is pending the user's faucet CAPTCHA. The active public record is cardano-preview.json, walletVersion 2. See [wallet repair](PREVIEW-WALLET-REPAIR.md).

Zcash Testnet: the dedicated key locally decrypted the expected **0.1 TAZ Ironwood V3 output**. The native transaction parser independently reproduced txid 6712dbc47ada8ebe89ca43419b70e092ea7fe126592e70ae608b67e67e7b6b96. The public Testnet server reported height 4335792 and 365 confirmations at the recorded observation time. See independent-server-observation.json and recipient-verification.json. No key, note randomness or memo was exported.

The spending witness is prepared: 373 compact blocks and 166 Ironwood actions were checked through height 4,336,164. The local note path matches the fetched tree root, and the funding nullifier was absent through that height. Private note data and witness remain in the restricted Linux wallet directory. That funding note has since been spent by the confirmed self-transfer below; use the new private note witnesses for further testing. The confirmation count is the public server's report, not a genesis-verified local sync or an authenticated Cardano relay.

The private Zcash key is confined to <restricted local wallet dir>/<key file>, mode 0600 in a 0700 directory. The usable replacement Cardano key is in task work/integrated-private-v2/testnet-cardano-preview-v2.dpapi, protected under the Windows user account. The old work/testnet-private/cardano-preview.seed.dpapi is empty and must not be used. Never copy private directories into exports or git. Public receiving details and raw public transaction bytes here are safe to synchronize.

The previous transparent-project funding notes led to the working free faucet at https://zcashfaucet.jinolabs.xyz/. No old wallet or key was reused. The user completed the Cardano faucet CAPTCHA. No new transaction was submitted during the receipt verification.

Sprints 0–2 are complete in local research scope; the authenticated relay remains Sprint 3 work. Production claim paths remain disabled. Public probe scripts must remain distinct from any production deployment.

## Confirmed dedicated-wallet self-transfer

Transaction 9bc3b878ffbc9ab457d51781e20af4a515751f0ad0c2cb4b4ce008cd0bf1418a was accepted by the Testnet server and reported mined at height 4336218. Its exact 9,166 bytes match the native proof/signature verification artifact. It sends 0.001 TAZ to another address under the same dedicated key and returns 0.0989 TAZ as change, with a 0.0001 TAZ free-test-token fee. Both new notes decrypt locally; both Merkle paths match the fetched Ironwood root and their nullifiers were absent through height 4336218. Their private witnesses are saved in the restricted Linux wallet directory, with no key copies or note plaintext in exports.

Known remaining notes total 0.0999 TAZ. Readiness is as of the scanned height and should be refreshed before a later spend. The old funding note has been spent by this confirmed self-transfer; do not reuse its old witness as a new input. See self-transfer-verification.json, self-transfer-submission.json, self-transfer-observation.json and self-transfer-witness-verification.json. This establishes native shielded Testnet wallet operation, not an atomic swap.
