import * as crypto from 'crypto';

export interface PrivacyCashNote {
  version: string;
  payment_type: 'privacy-cash';
  note_reference: string;
  amount_commitment: string;
  currency: string;
  nullifier_hint: string;
  note_id: string;
  timestamp: number;
  custody: 'non-custodial';
}

export interface PrivacyCashParams {
  amount: number;
  currency: string;
}

export function generatePrivacyCashNote(params: PrivacyCashParams): PrivacyCashNote {
  const note_id = crypto.randomBytes(16).toString('hex');
  const amount_commitment = generateCommitment(params.amount);
  const nullifier_hint = generateNullifier(note_id);
  const note_reference = generateNoteReference(note_id);

  return {
    version: '0.1.0',
    payment_type: 'privacy-cash',
    note_reference,
    amount_commitment,
    currency: params.currency,
    nullifier_hint,
    note_id,
    timestamp: Date.now(),
    custody: 'non-custodial'
  };
}

function generateCommitment(amount: number): string {
  const randomness = crypto.randomBytes(32);
  const commitment_input = Buffer.concat([
    Buffer.from(amount.toString()),
    randomness
  ]);
  
  return crypto
    .createHash('sha256')
    .update(commitment_input)
    .digest('hex');
}

function generateNullifier(note_id: string): string {
  return crypto
    .createHash('sha256')
    .update(`nullifier_${note_id}_${Date.now()}`)
    .digest('hex');
}

function generateNoteReference(note_id: string): string {
  return `privacy_note_${note_id}`;
}

export function verifyPrivacyCashNote(note: PrivacyCashNote): boolean {
  if (note.version !== '0.1.0') return false;
  if (note.payment_type !== 'privacy-cash') return false;
  if (note.custody !== 'non-custodial') return false;
  if (!note.note_reference.startsWith('privacy_note_')) return false;
  return true;
}
