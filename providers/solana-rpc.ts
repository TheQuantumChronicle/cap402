import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface TokenMetadata {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  supply?: number;
}

export interface TransactionDetails {
  signature: string;
  slot: number;
  blockTime: number;
  fee: number;
  status: 'success' | 'failed';
  instructions: any[];
}

class SolanaRPCProvider {
  private rpcUrl: string;
  private alchemyApiKey: string;

  constructor() {
    this.rpcUrl = process.env.SOLANA_RPC_URL || '';
    this.alchemyApiKey = process.env.ALCHEMY_API_KEY || '';
  }

  async getBalance(address: string): Promise<number> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        }
      );

      const lamports = response.data.result?.value || 0;
      return lamports / 1e9;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }

  async getTokenAccountsByOwner(owner: string, mint?: string): Promise<any[]> {
    try {
      const params: any = [
        owner,
        mint ? { mint } : { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ];

      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      return response.data.result?.value || [];
    } catch (error) {
      throw new Error(`Failed to get token accounts: ${error}`);
    }
  }

  async getTransaction(signature: string): Promise<TransactionDetails | null> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0
            }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      const tx = response.data.result;
      if (!tx) return null;

      return {
        signature,
        slot: tx.slot,
        blockTime: tx.blockTime * 1000,
        fee: tx.meta?.fee || 0,
        status: tx.meta?.err ? 'failed' : 'success',
        instructions: tx.transaction?.message?.instructions || []
      };
    } catch (error) {
      throw new Error(`Failed to get transaction: ${error}`);
    }
  }

  async getSignaturesForAddress(
    address: string,
    limit: number = 10
  ): Promise<string[]> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            address,
            { limit }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      const signatures = response.data.result || [];
      return signatures.map((sig: any) => sig.signature);
    } catch (error) {
      throw new Error(`Failed to get signatures: ${error}`);
    }
  }

  async getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            mint,
            { encoding: 'jsonParsed' }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        }
      );

      const accountInfo = response.data.result?.value;
      if (!accountInfo) return null;

      const parsed = accountInfo.data?.parsed?.info;
      if (!parsed) return null;

      return {
        mint,
        symbol: parsed.symbol || 'UNKNOWN',
        name: parsed.name || 'Unknown Token',
        decimals: parsed.decimals || 9,
        supply: parsed.supply ? parseInt(parsed.supply) / Math.pow(10, parsed.decimals) : undefined
      };
    } catch (error) {
      console.error('Failed to get token metadata:', error);
      return null;
    }
  }

  async getRecentBlockhash(): Promise<string> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestBlockhash',
          params: [{ commitment: 'finalized' }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        }
      );

      return response.data.result?.value?.blockhash || '';
    } catch (error) {
      throw new Error(`Failed to get recent blockhash: ${error}`);
    }
  }

  async sendTransaction(signedTransaction: string): Promise<string> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [
            signedTransaction,
            { encoding: 'base64' }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      return response.data.result || '';
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error}`);
    }
  }

  async confirmTransaction(signature: string, timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.post(
          this.rpcUrl,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignatureStatuses',
            params: [[signature]]
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        );

        const status = response.data.result?.value?.[0];
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
          return !status.err;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error checking transaction status:', error);
      }
    }

    return false;
  }
}

export const solanaRPC = new SolanaRPCProvider();
