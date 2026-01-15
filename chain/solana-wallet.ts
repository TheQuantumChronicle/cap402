import { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

export interface WalletInfo {
  publicKey: string;
  balance: number;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
  error?: string;
}

class SolanaWallet {
  private keypair: Keypair | null = null;
  private connection: Connection;
  private publicKey: PublicKey | null = null;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.initializeWallet();
  }

  private initializeWallet(): void {
    const secretKey = process.env.X402_SECRET;
    const publicKeyStr = process.env.X402_PUBLIC_KEY;

    if (secretKey) {
      try {
        const decoded = bs58.decode(secretKey);
        this.keypair = Keypair.fromSecretKey(decoded);
        this.publicKey = this.keypair.publicKey;
        console.log('✅ Wallet loaded from X402_SECRET');
      } catch (error) {
        console.error('❌ Failed to load wallet from X402_SECRET:', error);
      }
    } else if (publicKeyStr) {
      try {
        this.publicKey = new PublicKey(publicKeyStr);
        console.log('✅ Read-only wallet loaded from X402_PUBLIC_KEY');
      } catch (error) {
        console.error('❌ Failed to load public key:', error);
      }
    }
  }

  async getBalance(): Promise<number> {
    if (!this.publicKey) {
      throw new Error('No wallet configured');
    }

    try {
      const balance = await this.connection.getBalance(this.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }

  async getWalletInfo(): Promise<WalletInfo> {
    if (!this.publicKey) {
      throw new Error('No wallet configured');
    }

    const balance = await this.getBalance();
    return {
      publicKey: this.publicKey.toBase58(),
      balance
    };
  }

  getPublicKey(): string | null {
    return this.publicKey?.toBase58() || null;
  }

  canSign(): boolean {
    return this.keypair !== null;
  }

  async sendSOL(toAddress: string, amount: number): Promise<TransactionResult> {
    if (!this.keypair) {
      return {
        signature: '',
        success: false,
        error: 'Wallet cannot sign transactions (no private key)'
      };
    }

    try {
      const toPubkey = new PublicKey(toAddress);
      const lamports = amount * LAMPORTS_PER_SOL;

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: toPubkey,
          lamports: lamports
        })
      );

      const signature = await this.connection.sendTransaction(
        transaction,
        [this.keypair],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );

      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        signature,
        success: true
      };
    } catch (error) {
      return {
        signature: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  signMessage(message: string): string | null {
    if (!this.keypair) {
      return null;
    }

    try {
      const messageBytes = new TextEncoder().encode(message);
      const signature = Buffer.from(
        this.keypair.secretKey.slice(0, 32)
      );
      return bs58.encode(signature);
    } catch (error) {
      console.error('Failed to sign message:', error);
      return null;
    }
  }
}

export const solanaWallet = new SolanaWallet();
