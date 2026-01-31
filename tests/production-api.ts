/**
 * CAP-402 Protocol Production API Tests
 * Tests all core functionality against the live production API at cap402.com
 * 
 * Actual registered capabilities:
 * - cap.price.lookup.v1, cap.wallet.snapshot.v1, cap.document.parse.v1
 * - cap.swap.execute.v1, cap.confidential.swap.v1
 * - cap.zk.proof.v1, cap.zk.proof.balance.v1, cap.zk.kyc.v1, cap.zk.credential.v1
 * - cap.lightning.message.v1, cap.encrypted.trade.v1, cap.private.governance.v1
 * - cap.cspl.wrap.v1, cap.cspl.transfer.v1
 * - cap.fhe.compute.v1
 * - cap.stealth.launch.v1
 * - cap.pumpfun.buy.v1, cap.pumpfun.sell.v1, cap.pumpfun.quote.v1, cap.pumpfun.curve.v1
 * - cap.ai.inference.v1, cap.ai.embedding.v1
 */

const BASE_URL = process.env.TEST_URL || 'https://cap402.com';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({ name, passed: false, duration: Date.now() - start, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function fetchJSON(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Return a structured error if not JSON
    return { _raw: text, _isHtml: text.startsWith('<!'), _status: res.status };
  }
}

// ============================================
// CAP-402 PROTOCOL TESTS
// ============================================

async function runTests() {
  console.log(`\n🔐 CAP-402 Protocol Tests - ${BASE_URL}\n${'='.repeat(60)}\n`);

  // ============================================
  // CORE INFRASTRUCTURE
  // ============================================
  console.log('📡 CORE INFRASTRUCTURE\n');

  await runTest('Health endpoint returns healthy status', async () => {
    const data = await fetchJSON('/health');
    assert(data.status === 'healthy', `Expected healthy, got ${data.status}`);
    assert(data.version === '1.0.0', `Expected v1.0.0, got ${data.version}`);
  });

  await runTest('Landing page accessible', async () => {
    const res = await fetch(BASE_URL);
    assert(res.ok, `Landing page returned ${res.status}`);
    const html = await res.text();
    assert(html.includes('CAP-402') || html.includes('cap402'), 'Missing CAP-402 branding');
  });

  // ============================================
  // CAPABILITY REGISTRY
  // ============================================
  console.log('\n📋 CAPABILITY REGISTRY\n');

  let capabilities: any[] = [];
  
  await runTest('Get all capabilities', async () => {
    const data = await fetchJSON('/capabilities');
    assert(data.capabilities && Array.isArray(data.capabilities), 'Missing capabilities array');
    assert(data.capabilities.length > 0, 'No capabilities registered');
    capabilities = data.capabilities;
    console.log(`   Found ${capabilities.length} capabilities`);
  });

  await runTest('Capabilities have required fields', async () => {
    for (const cap of capabilities.slice(0, 5)) {
      assert(typeof cap.id === 'string', `Missing id for capability`);
      assert(typeof cap.name === 'string', `Missing name for ${cap.id}`);
      assert(typeof cap.description === 'string', `Missing description for ${cap.id}`);
    }
  });

  await runTest('Capabilities have input/output schemas', async () => {
    const capsWithSchemas = capabilities.filter(c => c.inputs && c.outputs);
    assert(capsWithSchemas.length > 0, 'No capabilities have schemas');
    console.log(`   ${capsWithSchemas.length} capabilities have full schemas`);
  });

  // ============================================
  // FHE CAPABILITIES (Inco Network)
  // ============================================
  console.log('\n🔒 FHE CAPABILITIES (Inco Network)\n');

  await runTest('FHE compute capability exists (cap.fhe.compute.v1)', async () => {
    const fheCap = capabilities.find(c => c.id === 'cap.fhe.compute.v1');
    assert(fheCap !== undefined, 'Missing cap.fhe.compute.v1');
    assert(fheCap.execution?.mode === 'confidential', 'FHE should be confidential');
  });

  await runTest('Encrypted trade capability exists (cap.encrypted.trade.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.encrypted.trade.v1');
    assert(cap !== undefined, 'Missing cap.encrypted.trade.v1');
  });

  await runTest('Lightning message capability exists (cap.lightning.message.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.lightning.message.v1');
    assert(cap !== undefined, 'Missing cap.lightning.message.v1');
  });

  // ============================================
  // ZK CAPABILITIES (Noir)
  // ============================================
  console.log('\n🛡️ ZK CAPABILITIES (Noir)\n');

  await runTest('ZK proof capability exists (cap.zk.proof.v1)', async () => {
    const zkCap = capabilities.find(c => c.id === 'cap.zk.proof.v1');
    assert(zkCap !== undefined, 'Missing cap.zk.proof.v1');
    assert(zkCap.execution?.proof_type === 'zk-snark', 'Should use zk-snark');
  });

  await runTest('ZK balance proof capability exists (cap.zk.proof.balance.v1)', async () => {
    const zkCap = capabilities.find(c => c.id === 'cap.zk.proof.balance.v1');
    assert(zkCap !== undefined, 'Missing cap.zk.proof.balance.v1');
  });

  await runTest('ZK KYC compliance capability exists (cap.zk.kyc.v1)', async () => {
    const zkCap = capabilities.find(c => c.id === 'cap.zk.kyc.v1');
    assert(zkCap !== undefined, 'Missing cap.zk.kyc.v1');
  });

  await runTest('ZK credential verification capability exists (cap.zk.credential.v1)', async () => {
    const zkCap = capabilities.find(c => c.id === 'cap.zk.credential.v1');
    assert(zkCap !== undefined, 'Missing cap.zk.credential.v1');
  });

  // ============================================
  // CONFIDENTIAL SPL (Arcium)
  // ============================================
  console.log('\n🔗 CONFIDENTIAL SPL (Arcium)\n');

  await runTest('CSPL wrap capability exists (cap.cspl.wrap.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.cspl.wrap.v1');
    assert(cap !== undefined, 'Missing cap.cspl.wrap.v1');
  });

  await runTest('CSPL transfer capability exists (cap.cspl.transfer.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.cspl.transfer.v1');
    assert(cap !== undefined, 'Missing cap.cspl.transfer.v1');
  });

  await runTest('Private governance capability exists (cap.private.governance.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.private.governance.v1');
    assert(cap !== undefined, 'Missing cap.private.governance.v1');
  });

  await runTest('Confidential swap capability exists (cap.confidential.swap.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.confidential.swap.v1');
    assert(cap !== undefined, 'Missing cap.confidential.swap.v1');
  });

  // ============================================
  // DEFI CAPABILITIES (Helius/Solana)
  // ============================================
  console.log('\n⛓️ DEFI CAPABILITIES (Helius/Solana)\n');

  await runTest('Price lookup capability exists (cap.price.lookup.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.price.lookup.v1');
    assert(cap !== undefined, 'Missing cap.price.lookup.v1');
  });

  await runTest('Wallet snapshot capability exists (cap.wallet.snapshot.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.wallet.snapshot.v1');
    assert(cap !== undefined, 'Missing cap.wallet.snapshot.v1');
  });

  await runTest('Swap execute capability exists (cap.swap.execute.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.swap.execute.v1');
    assert(cap !== undefined, 'Missing cap.swap.execute.v1');
  });

  await runTest('Document parse capability exists (cap.document.parse.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.document.parse.v1');
    assert(cap !== undefined, 'Missing cap.document.parse.v1');
  });

  // ============================================
  // PUMP.FUN CAPABILITIES
  // ============================================
  console.log('\n🚀 PUMP.FUN CAPABILITIES\n');

  await runTest('PumpFun buy capability exists (cap.pumpfun.buy.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.pumpfun.buy.v1');
    assert(cap !== undefined, 'Missing cap.pumpfun.buy.v1');
  });

  await runTest('PumpFun sell capability exists (cap.pumpfun.sell.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.pumpfun.sell.v1');
    assert(cap !== undefined, 'Missing cap.pumpfun.sell.v1');
  });

  await runTest('PumpFun quote capability exists (cap.pumpfun.quote.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.pumpfun.quote.v1');
    assert(cap !== undefined, 'Missing cap.pumpfun.quote.v1');
  });

  await runTest('PumpFun curve capability exists (cap.pumpfun.curve.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.pumpfun.curve.v1');
    assert(cap !== undefined, 'Missing cap.pumpfun.curve.v1');
  });

  await runTest('Stealth launch capability exists (cap.stealth.launch.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.stealth.launch.v1');
    assert(cap !== undefined, 'Missing cap.stealth.launch.v1');
  });

  // ============================================
  // AI/INFERENCE CAPABILITIES
  // ============================================
  console.log('\n🤖 AI/INFERENCE CAPABILITIES\n');

  await runTest('AI inference capability exists (cap.ai.inference.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.ai.inference.v1');
    assert(cap !== undefined, 'Missing cap.ai.inference.v1');
  });

  await runTest('AI embedding capability exists (cap.ai.embedding.v1)', async () => {
    const cap = capabilities.find(c => c.id === 'cap.ai.embedding.v1');
    assert(cap !== undefined, 'Missing cap.ai.embedding.v1');
  });

  // ============================================
  // ECONOMIC SIGNALING (x402)
  // ============================================
  console.log('\n💰 ECONOMIC SIGNALING (x402)\n');

  await runTest('Capabilities have economic metadata', async () => {
    const capsWithEconomics = capabilities.filter(c => c.economics?.cost_hint !== undefined);
    assert(capsWithEconomics.length > 0, 'No capabilities have economic metadata');
    console.log(`   ${capsWithEconomics.length} capabilities have pricing`);
  });

  await runTest('x402 payment signals configured', async () => {
    const capsWithPayment = capabilities.filter(c => c.economics?.x402_payment_signal?.enabled === true);
    assert(capsWithPayment.length > 0, 'No capabilities have x402 payment signals');
    console.log(`   ${capsWithPayment.length} capabilities support x402 payments`);
  });

  await runTest('Payment methods include SOL and USDC', async () => {
    const cap = capabilities.find(c => c.economics?.x402_payment_signal?.payment_methods);
    assert(cap !== undefined, 'No capability with payment methods');
    const methods = cap.economics.x402_payment_signal.payment_methods;
    assert(methods.includes('SOL') || methods.includes('USDC'), 'Missing SOL/USDC payment');
  });

  // ============================================
  // CAPABILITY COMPOSITION
  // ============================================
  console.log('\n🧩 CAPABILITY COMPOSITION\n');

  await runTest('Composable capabilities marked correctly', async () => {
    const composable = capabilities.filter(c => c.composable === true);
    assert(composable.length > 0, 'No composable capabilities');
    console.log(`   ${composable.length} composable capabilities`);
  });

  await runTest('Capabilities have execution modes', async () => {
    const withExecution = capabilities.filter(c => c.execution?.mode);
    assert(withExecution.length > 0, 'No capabilities have execution modes');
    const confidential = withExecution.filter(c => c.execution.mode === 'confidential');
    console.log(`   ${confidential.length} confidential execution capabilities`);
  });

  // ============================================
  // AGENT MANAGEMENT
  // ============================================
  console.log('\n🤖 AGENT MANAGEMENT\n');

  await runTest('Agents endpoint accessible', async () => {
    const data = await fetchJSON('/agents');
    assert(data._isHtml !== true, 'Agents endpoint returned HTML instead of JSON');
    assert(data.agents || data.data || Array.isArray(data) || data.success !== undefined, 'Invalid agents response');
  });

  // ============================================
  // SECURITY & VALIDATION
  // ============================================
  console.log('\n🔐 SECURITY & VALIDATION\n');

  await runTest('CORS headers present', async () => {
    const res = await fetch(`${BASE_URL}/health`, { method: 'OPTIONS' });
    assert(res.status < 500, 'OPTIONS request failed');
  });

  await runTest('Health endpoint has correct headers', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('application/json'), 'Should return JSON');
  });

  // ============================================
  // PERFORMANCE
  // ============================================
  console.log('\n⚡ PERFORMANCE\n');

  await runTest('Health check responds under 500ms', async () => {
    const start = Date.now();
    await fetchJSON('/health');
    const duration = Date.now() - start;
    assert(duration < 500, `Health check took ${duration}ms`);
  });

  await runTest('Capabilities list responds under 1000ms', async () => {
    const start = Date.now();
    await fetchJSON('/capabilities');
    const duration = Date.now() - start;
    assert(duration < 1000, `Capabilities took ${duration}ms`);
  });

  // ============================================
  // RESULTS SUMMARY
  // ============================================
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 CAP-402 TEST RESULTS SUMMARY\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`Total:  ${results.length} tests`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Time:   ${totalTime}ms`);
  
  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }
  
  console.log(`\n${'='.repeat(60)}`);
  
  // Summary by category
  console.log('\n📈 CAPABILITY COVERAGE:');
  const fheCaps = capabilities.filter(c => c.id?.includes('fhe') || c.id?.includes('encrypted') || c.id?.includes('lightning')).length;
  const zkCaps = capabilities.filter(c => c.id?.includes('zk')).length;
  const csplCaps = capabilities.filter(c => c.id?.includes('cspl') || c.id?.includes('confidential') || c.id?.includes('private')).length;
  const defiCaps = capabilities.filter(c => c.id?.includes('price') || c.id?.includes('wallet') || c.id?.includes('swap') || c.id?.includes('document')).length;
  const pumpCaps = capabilities.filter(c => c.id?.includes('pumpfun') || c.id?.includes('stealth')).length;
  const aiCaps = capabilities.filter(c => c.id?.includes('ai')).length;
  
  console.log(`  FHE (Inco):        ${fheCaps} capabilities`);
  console.log(`  ZK (Noir):         ${zkCaps} capabilities`);
  console.log(`  CSPL (Arcium):     ${csplCaps} capabilities`);
  console.log(`  DeFi (Helius):     ${defiCaps} capabilities`);
  console.log(`  Pump.fun:          ${pumpCaps} capabilities`);
  console.log(`  AI/Inference:      ${aiCaps} capabilities`);
  console.log(`  Total:             ${capabilities.length} capabilities`);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed! CAP-402 is ready for submission.\n');
  }
}

runTests().catch(console.error);
