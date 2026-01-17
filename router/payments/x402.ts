import { generateShortId } from '../../utils';
import * as crypto from 'crypto';

export interface X402Hint {
  version: string;
  payment_type: 'x402';
  ephemeral_payer: string;
  suggested_amount: number;
  currency: string;
  settlement_optional: boolean;
  payment_methods: string[];
  hint_id: string;
  timestamp: number;
}

export interface X402HintParams {
  amount: number;
  currency: string;
  settlement_optional: boolean;
}

export function generateX402Hint(params: X402HintParams): X402Hint {
  const ephemeral_payer = generateEphemeralAddress();
  const hint_id = generateShortId('hint', 16);

  return {
    version: '0.1.0',
    payment_type: 'x402',
    ephemeral_payer,
    suggested_amount: params.amount,
    currency: params.currency,
    settlement_optional: params.settlement_optional,
    payment_methods: ['SOL', 'USDC', 'credits'],
    hint_id,
    timestamp: Date.now()
  };
}

function generateEphemeralAddress(): string {
  const randomBytes = crypto.randomBytes(32);
  return `ephemeral_${randomBytes.toString('hex').substring(0, 44)}`;
}

export function verifyX402Hint(hint: X402Hint): boolean {
  if (hint.version !== '0.1.0') return false;
  if (hint.payment_type !== 'x402') return false;
  if (!hint.ephemeral_payer.startsWith('ephemeral_')) return false;
  if (hint.suggested_amount < 0) return false;
  return true;
}
