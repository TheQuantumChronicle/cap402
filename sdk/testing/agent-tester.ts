/**
 * Agent Tester - Real Integration Testing
 * 
 * Tests agents against the LIVE CAP-402 router with real data.
 * No mocks - all real API calls and transactions.
 */

import { CAP402Agent, createAgent, AgentConfig, InvokeResult } from '../agent';
import { EventEmitter } from 'events';

// ============================================
// TYPES
// ============================================

export interface TestCase {
  name: string;
  description?: string;
  capability_id: string;
  inputs: Record<string, any>;
  expected?: {
    success?: boolean;
    has_outputs?: string[];
    output_validators?: Record<string, (value: any) => boolean>;
  };
  timeout_ms?: number;
}

export interface TestSuite {
  name: string;
  description?: string;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  tests: TestCase[];
}

export interface TestResult {
  test_name: string;
  passed: boolean;
  duration_ms: number;
  result?: InvokeResult;
  error?: string;
  assertions: { name: string; passed: boolean; message?: string }[];
}

export interface SuiteResult {
  suite_name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  results: TestResult[];
}

// ============================================
// BUILT-IN TEST SUITES
// ============================================

export const CORE_CAPABILITY_TESTS: TestSuite = {
  name: 'Core Capabilities',
  description: 'Tests for essential CAP-402 capabilities',
  tests: [
    {
      name: 'Price Lookup - SOL/USD',
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL', quote_token: 'USD' },
      expected: {
        success: true,
        has_outputs: ['price'],
        output_validators: {
          price: (v) => typeof v === 'number' && v > 0
        }
      }
    },
    {
      name: 'Price Lookup - ETH/USD',
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'ETH', quote_token: 'USD' },
      expected: {
        success: true,
        has_outputs: ['price']
      }
    },
    {
      name: 'Price Lookup - BTC/USD',
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'BTC', quote_token: 'USD' },
      expected: {
        success: true,
        has_outputs: ['price']
      }
    },
    {
      name: 'Wallet Snapshot',
      capability_id: 'cap.wallet.snapshot.v1',
      inputs: { 
        address: '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j',
        network: 'solana-mainnet'
      },
      expected: {
        success: true,
        has_outputs: ['address', 'balances']
      }
    }
  ]
};

export const SWAP_TESTS: TestSuite = {
  name: 'Swap Capabilities',
  description: 'Tests for token swap capabilities',
  tests: [
    {
      name: 'Swap Execute',
      capability_id: 'cap.swap.execute.v1',
      inputs: {
        token_in: 'SOL',
        token_out: 'USDC',
        amount_in: 0.001,
        slippage: 0.5
      },
      expected: {
        success: true
      }
    }
  ]
};

export const A2A_PROTOCOL_TESTS: TestSuite = {
  name: 'A2A Protocol',
  description: 'Tests for agent-to-agent communication',
  tests: [
    {
      name: 'Agent Discovery',
      capability_id: 'cap.a2a.discover.v1',
      inputs: { capability: 'cap.price.lookup.v1' },
      expected: {
        success: true
      }
    }
  ]
};

// ============================================
// AGENT TESTER
// ============================================

export class AgentTester extends EventEmitter {
  private agent: CAP402Agent;
  private results: SuiteResult[] = [];

  constructor(config?: Partial<AgentConfig>) {
    super();

    this.agent = createAgent({
      agent_id: config?.agent_id || `tester-${Date.now()}`,
      name: config?.name || 'CAP-402 Agent Tester',
      router_url: config?.router_url || process.env.CAP402_ROUTER || 'https://cap402.com',
      description: 'Integration testing agent',
      capabilities_provided: [],
      capabilities_required: [],
      log_level: 'warn',
      ...config
    });
  }

  async connect(): Promise<void> {
    await this.agent.start();
    console.log('✓ Connected to router\n');
  }

  async disconnect(): Promise<void> {
    await this.agent.stop();
  }

  async runSuite(suite: TestSuite): Promise<SuiteResult> {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${suite.name}`);
    if (suite.description) console.log(`  ${suite.description}`);
    console.log(`${'═'.repeat(60)}\n`);

    const startTime = Date.now();
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Run setup
    if (suite.setup) {
      try {
        await suite.setup();
      } catch (error) {
        console.error('Suite setup failed:', error);
        return {
          suite_name: suite.name,
          total: suite.tests.length,
          passed: 0,
          failed: 0,
          skipped: suite.tests.length,
          duration_ms: Date.now() - startTime,
          results: []
        };
      }
    }

    // Run tests
    for (const test of suite.tests) {
      const result = await this.runTest(test);
      results.push(result);

      if (result.passed) {
        passed++;
        console.log(`  ✓ ${test.name} (${result.duration_ms}ms)`);
      } else {
        failed++;
        console.log(`  ✗ ${test.name}`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
        for (const assertion of result.assertions) {
          if (!assertion.passed) {
            console.log(`    - ${assertion.name}: ${assertion.message}`);
          }
        }
      }
    }

    // Run teardown
    if (suite.teardown) {
      try {
        await suite.teardown();
      } catch (error) {
        console.error('Suite teardown failed:', error);
      }
    }

    const suiteResult: SuiteResult = {
      suite_name: suite.name,
      total: suite.tests.length,
      passed,
      failed,
      skipped,
      duration_ms: Date.now() - startTime,
      results
    };

    this.results.push(suiteResult);

    console.log(`\n  ${passed}/${suite.tests.length} passed (${suiteResult.duration_ms}ms)\n`);

    return suiteResult;
  }

  async runTest(test: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    const assertions: { name: string; passed: boolean; message?: string }[] = [];

    try {
      const result = await this.agent.invoke(
        test.capability_id,
        test.inputs,
        { timeout_ms: test.timeout_ms || 30000 }
      );

      const duration = Date.now() - startTime;

      // Check expected success
      if (test.expected?.success !== undefined) {
        const passed = result.success === test.expected.success;
        assertions.push({
          name: 'success',
          passed,
          message: passed ? undefined : `Expected success=${test.expected.success}, got ${result.success}`
        });
      }

      // Check expected outputs exist
      if (test.expected?.has_outputs && result.outputs) {
        for (const key of test.expected.has_outputs) {
          const hasKey = key in result.outputs;
          assertions.push({
            name: `has_output:${key}`,
            passed: hasKey,
            message: hasKey ? undefined : `Missing output: ${key}`
          });
        }
      }

      // Run output validators
      if (test.expected?.output_validators && result.outputs) {
        for (const [key, validator] of Object.entries(test.expected.output_validators)) {
          try {
            const value = result.outputs[key];
            const valid = validator(value);
            assertions.push({
              name: `validate:${key}`,
              passed: valid,
              message: valid ? undefined : `Validation failed for ${key}: ${JSON.stringify(value)}`
            });
          } catch (e) {
            assertions.push({
              name: `validate:${key}`,
              passed: false,
              message: `Validator threw: ${e}`
            });
          }
        }
      }

      const allPassed = assertions.every(a => a.passed);

      return {
        test_name: test.name,
        passed: allPassed,
        duration_ms: duration,
        result,
        assertions
      };

    } catch (error) {
      return {
        test_name: test.name,
        passed: false,
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        assertions
      };
    }
  }

  async runAllBuiltIn(): Promise<SuiteResult[]> {
    const suites = [
      CORE_CAPABILITY_TESTS,
      SWAP_TESTS,
      A2A_PROTOCOL_TESTS
    ];

    for (const suite of suites) {
      await this.runSuite(suite);
    }

    return this.results;
  }

  getResults(): SuiteResult[] {
    return this.results;
  }

  getSummary(): {
    total_suites: number;
    total_tests: number;
    total_passed: number;
    total_failed: number;
    pass_rate: number;
    total_duration_ms: number;
  } {
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    for (const suite of this.results) {
      totalTests += suite.total;
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalDuration += suite.duration_ms;
    }

    return {
      total_suites: this.results.length,
      total_tests: totalTests,
      total_passed: totalPassed,
      total_failed: totalFailed,
      pass_rate: totalTests > 0 ? totalPassed / totalTests : 0,
      total_duration_ms: totalDuration
    };
  }

  printSummary(): void {
    const summary = this.getSummary();

    console.log('\n' + '═'.repeat(60));
    console.log('  TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Suites: ${summary.total_suites}`);
    console.log(`  Tests:  ${summary.total_passed}/${summary.total_tests} passed`);
    console.log(`  Rate:   ${(summary.pass_rate * 100).toFixed(1)}%`);
    console.log(`  Time:   ${summary.total_duration_ms}ms`);
    console.log('═'.repeat(60) + '\n');
  }
}

// ============================================
// CAPABILITY VALIDATOR
// ============================================

export class CapabilityValidator {
  private agent: CAP402Agent;

  constructor(routerUrl?: string) {
    this.agent = createAgent({
      agent_id: `validator-${Date.now()}`,
      name: 'Capability Validator',
      router_url: routerUrl || 'https://cap402.com',
      log_level: 'error'
    });
  }

  async connect(): Promise<void> {
    await this.agent.start();
  }

  async disconnect(): Promise<void> {
    await this.agent.stop();
  }

  async validateCapability(
    capabilityId: string,
    testInputs: Record<string, any>
  ): Promise<{
    valid: boolean;
    latency_ms: number;
    outputs?: any;
    error?: string;
  }> {
    const start = Date.now();

    try {
      const result = await this.agent.invoke(capabilityId, testInputs);
      
      return {
        valid: result.success,
        latency_ms: Date.now() - start,
        outputs: result.outputs,
        error: result.error
      };
    } catch (error) {
      return {
        valid: false,
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async benchmarkCapability(
    capabilityId: string,
    testInputs: Record<string, any>,
    iterations: number = 10
  ): Promise<{
    capability_id: string;
    iterations: number;
    success_rate: number;
    latency: {
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
    };
  }> {
    const latencies: number[] = [];
    let successes = 0;

    for (let i = 0; i < iterations; i++) {
      const result = await this.validateCapability(capabilityId, testInputs);
      latencies.push(result.latency_ms);
      if (result.valid) successes++;
    }

    latencies.sort((a, b) => a - b);

    return {
      capability_id: capabilityId,
      iterations,
      success_rate: successes / iterations,
      latency: {
        min: latencies[0],
        max: latencies[latencies.length - 1],
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)]
      }
    };
  }
}

// ============================================
// QUICK TEST RUNNER
// ============================================

export async function runQuickTest(routerUrl?: string): Promise<void> {
  console.log('\n🧪 CAP-402 Quick Test\n');
  console.log(`Router: ${routerUrl || 'https://cap402.com'}\n`);

  const tester = new AgentTester({ router_url: routerUrl });

  try {
    await tester.connect();
    await tester.runSuite(CORE_CAPABILITY_TESTS);
    tester.printSummary();
  } finally {
    await tester.disconnect();
  }
}

// CLI entry point
if (require.main === module) {
  const routerUrl = process.argv[2] || process.env.CAP402_ROUTER;
  runQuickTest(routerUrl).catch(console.error);
}
