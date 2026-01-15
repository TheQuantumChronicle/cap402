import { solanaWallet } from '../chain/solana-wallet';
import * as dotenv from 'dotenv';

dotenv.config();

export interface PaymentRequest {
  amount: number;
  currency: string;
  recipient?: string;
  memo?: string;
}

export interface PaymentResult {
  success: boolean;
  signature?: string;
  error?: string;
  timestamp: number;
}

class PaymentProcessor {
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    const timestamp = Date.now();

    if (request.currency !== 'SOL') {
      return {
        success: false,
        error: 'Only SOL payments supported currently',
        timestamp
      };
    }

    if (!request.recipient) {
      return {
        success: false,
        error: 'Recipient address required',
        timestamp
      };
    }

    if (!solanaWallet.canSign()) {
      return {
        success: false,
        error: 'Wallet cannot sign transactions (read-only mode)',
        timestamp
      };
    }

    try {
      const result = await solanaWallet.sendSOL(request.recipient, request.amount);
      
      return {
        success: result.success,
        signature: result.signature,
        error: result.error,
        timestamp
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment failed',
        timestamp
      };
    }
  }

  async getWalletBalance(): Promise<number> {
    try {
      return await solanaWallet.getBalance();
    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return 0;
    }
  }

  getWalletAddress(): string | null {
    return solanaWallet.getPublicKey();
  }

  canProcessPayments(): boolean {
    return solanaWallet.canSign();
  }
}

export const paymentProcessor = new PaymentProcessor();
