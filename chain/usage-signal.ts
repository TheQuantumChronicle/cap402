import * as crypto from 'crypto';

// Stats tracking
const usageStats = {
  totalSignals: 0,
  successfulSignals: 0,
  failedSignals: 0,
  totalCost: 0,
  signalsByCapability: new Map<string, number>()
};

/**
 * Get usage signal statistics
 */
export function getUsageSignalStats(): {
  totalSignals: number;
  successfulSignals: number;
  failedSignals: number;
  successRate: string;
  totalCost: number;
  topCapabilities: { capability_id: string; count: number }[];
} {
  const topCapabilities = Array.from(usageStats.signalsByCapability.entries())
    .map(([capability_id, count]) => ({ capability_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const successRate = usageStats.totalSignals > 0
    ? ((usageStats.successfulSignals / usageStats.totalSignals) * 100).toFixed(1) + '%'
    : '0%';
  
  return {
    totalSignals: usageStats.totalSignals,
    successfulSignals: usageStats.successfulSignals,
    failedSignals: usageStats.failedSignals,
    successRate,
    totalCost: usageStats.totalCost,
    topCapabilities
  };
}

export interface UsageSignal {
  signal_id: string;
  capability_id: string;
  request_id: string;
  timestamp: number;
  success: boolean;
  cost?: number;
  commitment_hash: string;
  network: string;
  version: string;
  metadata: {
    signal_type: 'usage-commitment';
    verifiable: boolean;
    settlement_ready: boolean;
  };
}

export interface UsageSignalParams {
  capability_id: string;
  request_id: string;
  timestamp: number;
  success: boolean;
  cost?: number;
}

export async function emitUsageSignal(params: UsageSignalParams): Promise<UsageSignal> {
  const signal_id = generateSignalId();
  const commitment_hash = generateCommitmentHash(params);

  const signal: UsageSignal = {
    signal_id,
    capability_id: params.capability_id,
    request_id: params.request_id,
    timestamp: params.timestamp,
    success: params.success,
    cost: params.cost,
    commitment_hash,
    network: 'solana-devnet',
    version: '0.1.0',
    metadata: {
      signal_type: 'usage-commitment',
      verifiable: true,
      settlement_ready: false
    }
  };

  // Track stats
  usageStats.totalSignals++;
  if (params.success) {
    usageStats.successfulSignals++;
  } else {
    usageStats.failedSignals++;
  }
  if (params.cost) {
    usageStats.totalCost += params.cost;
  }
  const capCount = usageStats.signalsByCapability.get(params.capability_id) || 0;
  usageStats.signalsByCapability.set(params.capability_id, capCount + 1);

  await simulateChainEmission(signal);

  return signal;
}

function generateSignalId(): string {
  // Fast ID generation without crypto overhead
  return `signal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function generateCommitmentHash(params: UsageSignalParams): string {
  const commitment_data = JSON.stringify({
    capability_id: params.capability_id,
    request_id: params.request_id,
    timestamp: params.timestamp,
    success: params.success,
    cost: params.cost
  });

  return crypto
    .createHash('sha256')
    .update(commitment_data)
    .digest('hex');
}

async function simulateChainEmission(signal: UsageSignal): Promise<void> {
  // Fast path - no blocking in dev mode
  const txSignature = `tx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  
  // Only log in non-test environment to avoid Jest warnings
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[CHAIN SIGNAL] Usage commitment ready for ${signal.network}`);
    console.log(`  Signal ID: ${signal.signal_id}`);
    console.log(`  Commitment: ${signal.commitment_hash.substring(0, 16)}...`);
    console.log(`  TX Signature: ${txSignature}`);
    console.log(`  Verifiable: ${signal.metadata.verifiable}`);
  }
}

export function verifyUsageSignal(signal: UsageSignal, params: UsageSignalParams): boolean {
  const recomputed_hash = generateCommitmentHash(params);
  return recomputed_hash === signal.commitment_hash;
}
