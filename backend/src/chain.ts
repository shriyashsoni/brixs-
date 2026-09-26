import { ethers } from 'ethers';
import { config } from './config';

/**
 * Single provider + signer shared by every service.
 * Separate Wallet instances on the same key race each other for nonces.
 */
export const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: false });
export const wallet = new ethers.Wallet(config.privateKey, provider);
export const signerAddress = wallet.address;

// Serialize submission and assign nonces locally: RPCs can report a stale "pending" count
// right after a transaction is mined, which makes back-to-back sends collide.
let txQueue: Promise<unknown> = Promise.resolve();
let nextNonce: number | null = null;

export type TxOverrides = { nonce: number };

export async function sendTx(
  send: (overrides: TxOverrides) => Promise<ethers.ContractTransactionResponse>
): Promise<ethers.TransactionReceipt> {
  const submit = async () => {
    if (nextNonce === null) nextNonce = await provider.getTransactionCount(signerAddress, 'pending');
    try {
      const tx = await send({ nonce: nextNonce });
      nextNonce++;
      return tx;
    } catch (err) {
      nextNonce = null; // re-sync from the node on the next send
      throw err;
    }
  };
  const sent = txQueue.then(submit, submit);
  txQueue = sent.catch(() => undefined);
  const tx = await sent;
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`Transaction ${tx.hash} was dropped`);
  return receipt;
}

/** Pull a human-readable reason out of an ethers error */
export function chainError(err: any): string {
  return (
    err?.reason ||
    err?.revert?.args?.[0] ||
    err?.info?.error?.message ||
    err?.shortMessage ||
    err?.message ||
    'Unknown chain error'
  );
}

export function isRpcUnavailable(err: any): boolean {
  const code = err?.code;
  return (
    code === 'NETWORK_ERROR' ||
    code === 'SERVER_ERROR' ||
    code === 'TIMEOUT' ||
    code === 'ECONNREFUSED' ||
    /ECONNREFUSED|failed to detect network|fetch failed|getaddrinfo/i.test(String(err?.message))
  );
}

let networkCache: { chainId: number; at: number } | null = null;

/** Chain ID, or null when the RPC can't be reached. Cached for 30s. */
export async function getChainId(): Promise<number | null> {
  if (networkCache && Date.now() - networkCache.at < 30_000) return networkCache.chainId;
  try {
    const network = await Promise.race([
      provider.getNetwork(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 4000)),
    ]);
    networkCache = { chainId: Number(network.chainId), at: Date.now() };
    return networkCache.chainId;
  } catch {
    return null;
  }
}
