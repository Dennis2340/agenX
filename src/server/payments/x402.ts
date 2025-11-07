import fs from 'fs'
import path from 'path'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { createPaymentHandler } from '@faremeter/payment-solana/exact'
import { wrap as wrapFetch } from '@faremeter/fetch'
import { lookupKnownSPLToken } from '@faremeter/info/solana'

function loadKeypairFromEnv(): Keypair {
  const inline = process.env.PAYER_KEYPAIR_JSON
  if (inline) {
    try {
      const arr = JSON.parse(inline)
      if (Array.isArray(arr) && arr.length > 0) {
        return Keypair.fromSecretKey(Uint8Array.from(arr))
      }
    } catch {}
  }
  const p = process.env.PAYER_KEYPAIR_PATH || './secrets/agenx-wallet.json'
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p)
  const raw = fs.readFileSync(abs, 'utf-8')
  const secret = JSON.parse(raw) as number[]
  return Keypair.fromSecretKey(Uint8Array.from(secret))
}

type Cluster = 'devnet' | 'testnet' | 'mainnet-beta'

export function getPaidFetcher() {
  const envNet = process.env.SOLANA_NETWORK || 'devnet'
  const allowed: Cluster[] = ['devnet','testnet','mainnet-beta']
  const network: Cluster = (allowed as readonly string[]).includes(envNet) ? (envNet as Cluster) : 'devnet'
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const connection = new Connection(rpc, 'confirmed')
  const keypair = loadKeypairFromEnv()

  const info = lookupKnownSPLToken(network, 'USDC')
  const mintStr = process.env.USDC_MINT || info?.address
  if (!mintStr) {
    throw new Error(`USDC mint not found for network=${network}. Set USDC_MINT in env or ensure lookupKnownSPLToken supports this cluster.`)
  }
  const usdcMint = new PublicKey(mintStr)

  const wallet = {
    network,
    publicKey: keypair.publicKey,
    updateTransaction: async (tx: any) => {
      tx.sign([keypair])
      return tx
    },
  }

  const handler = createPaymentHandler(wallet as any, usdcMint, connection)
  const paidFetch = wrapFetch(fetch, { handlers: [handler] })
  return paidFetch
}

export function getSolanaConnection() {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  return new Connection(rpc, 'confirmed')
}

export async function sendSol(to: string, amountSol: string): Promise<{ tx: string }> {
  const connection = getSolanaConnection()
  const payer = loadKeypairFromEnv()
  const lamports = BigInt(Math.floor(parseFloat(amountSol) * 1e9))
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(to), lamports: Number(lamports) }))
  const sig = await sendAndConfirmTransaction(connection, tx, [payer])
  return { tx: sig }
}

export function extractPaidHeaders(res: Response): { amount?: string; currency?: string } {
  try {
    const amount = res.headers.get('x-402-amount') || res.headers.get('x-paid-amount') || undefined
    const currency = res.headers.get('x-402-currency') || res.headers.get('x-paid-currency') || 'USDC'
    return { amount: amount || undefined, currency }
  } catch {
    return {}
  }
}
