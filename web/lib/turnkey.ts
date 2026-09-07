/**
 * Turnkey key management (replaces Web3Auth MPC — see docs/mpc-setup.md).
 *
 * One Turnkey organization (Saku's) owns one sub-organization per user. Saku's own API keypair
 * is registered as the sub-organization's root user at creation time, so the same server-side
 * credentials that create a sub-org can also sign with its wallet later — there is no per-user
 * credential to juggle.
 *
 * This is a deliberate move away from Web3Auth's threshold model. Signing now lives entirely on
 * this server: Saku's backend, holding a valid session for a phone number, can always produce a
 * signature for that user's wallet. Turnkey's enclave means the private key itself never touches
 * this process or any database — a compromised server yields the ability to request signatures
 * while a session exists, not a key it can exfiltrate — but it is not the 2-of-3 non-custodial
 * threshold the Web3Auth integration aimed for. That trade was made deliberately after Web3Auth's
 * sapphire_devnet signing infrastructure proved unreliable in production testing (see the
 * project's incident notes); it should not be re-derived by accident by whoever reads this next.
 */

import { getAddress } from 'ethers';
import { Turnkey as TurnkeyServerSDK } from '@turnkey/sdk-server';

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see docs/mpc-setup.md`);
  return value;
}

let sdkSingleton: TurnkeyServerSDK | null = null;

function sdk(): TurnkeyServerSDK {
  if (sdkSingleton) return sdkSingleton;
  sdkSingleton = new TurnkeyServerSDK({
    apiBaseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
    apiPublicKey: readEnv('TURNKEY_API_PUBLIC_KEY'),
    apiPrivateKey: readEnv('TURNKEY_API_PRIVATE_KEY'),
    defaultOrganizationId: readEnv('TURNKEY_ORGANIZATION_ID'),
  });
  return sdkSingleton;
}

export interface TurnkeyWallet {
  subOrgId: string;
  walletId: string;
  address: string;
}

/**
 * Create a sub-organization and its one Ethereum wallet for a user who has never signed in
 * before. Saku's own API key is enrolled as the sub-org's root user in the same call, which is
 * what lets {@link signWithWallet} authenticate against `subOrgId` later using those same
 * credentials rather than a key scoped to the sub-org itself.
 *
 * @param phoneHash keccak256 of the caller's phone number. Only ever used as a label here — it
 * is not sent anywhere Turnkey would treat it as PII, and Saku's own `wallets` table is what
 * actually maps it to the resulting address.
 */
export async function createUserWallet(phoneHash: string): Promise<TurnkeyWallet> {
  const client = sdk().apiClient();

  const result = await client.createSubOrganization({
    subOrganizationName: `saku-${phoneHash.slice(0, 16)}`,
    rootUsers: [
      {
        userName: 'saku-backend',
        apiKeys: [
          {
            apiKeyName: 'saku-backend-server',
            publicKey: readEnv('TURNKEY_API_PUBLIC_KEY'),
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: 'primary',
      accounts: [
        {
          curve: 'CURVE_SECP256K1',
          pathFormat: 'PATH_FORMAT_BIP32',
          path: ETH_DERIVATION_PATH,
          addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
        },
      ],
    },
  });

  const address = result.wallet?.addresses?.[0];
  const walletId = result.wallet?.walletId;
  if (!address || !walletId) {
    throw new Error('Turnkey did not return a wallet for the new sub-organization');
  }

  return { subOrgId: result.subOrganizationId, walletId, address: address.toLowerCase() };
}

/**
 * Sign a raw unsigned Ethereum transaction with a user's Turnkey wallet.
 *
 * `unsignedTransaction` is the RLP-encoded unsigned transaction as a hex string — with or
 * without a `0x` prefix, both are normalized here since Turnkey's API expects it bare. The
 * returned signed transaction is normalized back to a `0x`-prefixed hex string, ready for
 * `provider.broadcastTransaction`.
 *
 * `address` is looked up by exact string match on Turnkey's side against the EIP-55 checksummed
 * form it created the wallet account with — `Turnkey error 5: Could not find any resource to
 * sign with` is what a lowercase address (the form the `evm_address` DB column requires) gets
 * back. `getAddress` re-checksums it here rather than changing what's stored, since the DB
 * constraint has its own reason to want lowercase.
 */
export async function signWithWallet(
  subOrgId: string,
  address: string,
  unsignedTransactionHex: string
): Promise<string> {
  const client = sdk().apiClient();
  const bare = unsignedTransactionHex.startsWith('0x')
    ? unsignedTransactionHex.slice(2)
    : unsignedTransactionHex;

  const result = await client.signTransaction({
    organizationId: subOrgId,
    signWith: getAddress(address),
    unsignedTransaction: bare,
    type: 'TRANSACTION_TYPE_ETHEREUM',
  });

  const signed = result.signedTransaction;
  return signed.startsWith('0x') ? signed : `0x${signed}`;
}
