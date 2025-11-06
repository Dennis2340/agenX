import fs from 'fs'
import path from 'path'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'

export function getConnection() {
  const url = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  return new Connection(url, 'confirmed')
}

export function loadTreasuryKeypair(): Keypair {
  // 1) Direct JSON array in env
  const json = process.env.PAYER_KEYPAIR_JSON
  if (json) {
    const arr = JSON.parse(json) as number[]
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  // 2) Base64 of the JSON array
  const b64 = process.env.PAYER_KEYPAIR_B64
  if (b64) {
    const raw = Buffer.from(b64, 'base64').toString('utf8')
    const arr = JSON.parse(raw) as number[]
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  // 3) Fallback to file path (local dev)
  const p = process.env.PAYER_KEYPAIR_PATH || './secrets/agenx-wallet.json'
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p)
  const raw = fs.readFileSync(abs, 'utf-8')
  const secret = JSON.parse(raw) as number[]
  return Keypair.fromSecretKey(Uint8Array.from(secret))
}

export async function transferSol(recipient: string, amountSol: number): Promise<string> {
  const conn = getConnection()
  const payer = loadTreasuryKeypair()
  const toPubkey = new PublicKey(recipient)
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL)

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey, lamports })
  )

  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' })
  return sig
}

export async function getSolPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
    if (!res.ok) return null
    const data = await res.json().catch(()=>null)
    const price = data?.solana?.usd
    return typeof price === 'number' ? price : null
  } catch {
    return null
  }
}

export async function usdToSol(usd: number): Promise<number | null> {
  const price = await getSolPriceUsd()
  if (!price || price <= 0) return null
  return usd / price
}
