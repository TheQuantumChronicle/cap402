/**
 * Providers Module - Barrel Export
 * 
 * Central export point for all provider implementations.
 * Enables cleaner imports: import { arciumProvider, noirCircuitsProvider } from '../providers';
 */

// Privacy & Confidential Compute Providers
export { arciumProvider, ArciumComputationRequest, ArciumComputationResult } from './arcium-client';
export { arciumCSPLProvider } from './arcium-cspl';
export { incoFHEProvider, FHECiphertext, FHEComputationResult, ConfidentialMessage, FHE_OPERATIONS } from './inco-fhe';
export { noirCircuitsProvider, NoirCircuit, NoirProof, VerificationResult } from './noir-circuits';
export { confidentialExecutionPipeline } from './confidential-execution';

// Trading & Market Data Providers
export { priceProvider } from './price';
export { swapProvider } from './swap';
export { walletProvider } from './wallet';

// Solana Infrastructure
export { solanaRPC } from './solana-rpc';
export { heliusDASProvider } from './helius-das';
export { heliusWebhookManager } from './helius-webhooks';

// Market Intelligence
export { whaleTrackerService } from './whale-tracker';
export { smartMoneyService } from './smart-money';
export { arbitrageScannerService } from './arbitrage-scanner';
export { liquidationMonitorService } from './liquidation-monitor';
export { birdEyeClient } from './birdeye-websocket';

// Integration & Payments
export { integrationManager } from './integration-manager';
export { paymentProcessor } from './payment-processor';
