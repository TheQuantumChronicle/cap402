import { Capability, CORE_CAPABILITIES } from '../spec/capabilities';

export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();

  constructor() {
    this.loadCoreCapabilities();
  }

  private loadCoreCapabilities(): void {
    for (const capability of CORE_CAPABILITIES) {
      this.capabilities.set(capability.id, capability);
    }
  }

  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  getAllCapabilities(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  getCapabilitiesByTag(tag: string): Capability[] {
    return this.getAllCapabilities().filter(cap => 
      cap.metadata?.tags?.includes(tag)
    );
  }

  getCapabilitiesByMode(mode: 'public' | 'confidential'): Capability[] {
    return this.getAllCapabilities().filter(cap => 
      cap.execution.mode === mode
    );
  }

  registerCapability(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability ${capability.id} already registered`);
    }
    this.capabilities.set(capability.id, capability);
  }

  isDeprecated(id: string): boolean {
    const capability = this.getCapability(id);
    return capability?.deprecated || false;
  }

  /**
   * Get sponsor for a capability
   */
  getSponsor(capabilityId: string): string | null {
    const sponsorMap: Record<string, string> = {
      'cap.cspl.wrap.v1': 'Arcium',
      'cap.cspl.transfer.v1': 'Arcium',
      'cap.confidential.swap.v1': 'Arcium',
      'cap.zk.proof.v1': 'Aztec/Noir',
      'cap.wallet.snapshot.v1': 'Helius',
      'cap.lightning.message.v1': 'Inco',
      'cap.fhe.compute.v1': 'Inco',
      'cap.private.governance.v1': 'Inco',
      'cap.encrypted.trade.v1': 'Inco'
    };
    return sponsorMap[capabilityId] || null;
  }

  /**
   * Get all capabilities by sponsor
   */
  getCapabilitiesBySponsor(sponsor: string): Capability[] {
    return this.getAllCapabilities().filter(cap => 
      this.getSponsor(cap.id)?.toLowerCase() === sponsor.toLowerCase()
    );
  }

  /**
   * Get capability summary with sponsor info
   */
  getCapabilitySummary(): {
    total: number;
    by_mode: { public: number; confidential: number };
    by_sponsor: Record<string, number>;
  } {
    const caps = this.getAllCapabilities();
    const byMode = { public: 0, confidential: 0 };
    const bySponsor: Record<string, number> = {};

    for (const cap of caps) {
      byMode[cap.execution.mode]++;
      const sponsor = this.getSponsor(cap.id) || 'Core';
      bySponsor[sponsor] = (bySponsor[sponsor] || 0) + 1;
    }

    return { total: caps.length, by_mode: byMode, by_sponsor: bySponsor };
  }
}

export const registry = new CapabilityRegistry();
