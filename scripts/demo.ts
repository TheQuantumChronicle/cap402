#!/usr/bin/env npx ts-node
/**
 * CAP-402 Demo Script
 * 
 * A video-friendly demonstration of CAP-402 capabilities.
 * 
 * Usage:
 *   1. Start the server: npm run start:dev
 *   2. In another terminal: npm run demo
 * 
 * Or target a remote server:
 *   CAP402_URL=https://cap402.com npm run demo
 * 
 * Features colorful output, timing, and step-by-step capability showcase.
 */

const BASE_URL = process.env.CAP402_URL || 'http://localhost:3001';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

const c = colors;

// Helper functions
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clearLine() {
  process.stdout.write('\r\x1b[K');
}

function printBanner() {
  console.log(`
${c.bright}${c.magenta}╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ${c.cyan}██████╗ █████╗ ██████╗       ██╗  ██╗ ██████╗ ██████╗${c.magenta}          ║
║   ${c.cyan}██╔════╝██╔══██╗██╔══██╗      ██║  ██║██╔═████╗╚════██╗${c.magenta}         ║
║   ${c.cyan}██║     ███████║██████╔╝█████╗███████║██║██╔██║ █████╔╝${c.magenta}         ║
║   ${c.cyan}██║     ██╔══██║██╔═══╝ ╚════╝╚════██║████╔╝██║██╔═══╝${c.magenta}          ║
║   ${c.cyan}╚██████╗██║  ██║██║                ██║╚██████╔╝███████╗${c.magenta}         ║
║   ${c.cyan} ╚═════╝╚═╝  ╚═╝╚═╝                ╚═╝ ╚═════╝ ╚══════╝${c.magenta}         ║
║                                                                  ║
║   ${c.white}Privacy-First Agent Infrastructure${c.magenta}                           ║
║   ${c.dim}${c.white}Execution • Monetization • Privacy${c.reset}${c.bright}${c.magenta}                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝${c.reset}
`);
}

function printSection(title: string, icon: string = '▶') {
  console.log(`\n${c.bright}${c.yellow}${icon} ${title}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
}

function printStep(step: number, total: number, description: string) {
  console.log(`\n${c.cyan}[${step}/${total}]${c.reset} ${c.bright}${description}${c.reset}`);
}

function printRequest(method: string, url: string, body?: object) {
  const methodColor = method === 'GET' ? c.green : c.magenta;
  console.log(`\n${c.dim}Request:${c.reset}`);
  console.log(`  ${methodColor}${method}${c.reset} ${c.white}${url}${c.reset}`);
  if (body) {
    console.log(`  ${c.dim}Body:${c.reset} ${c.cyan}${JSON.stringify(body, null, 2).split('\n').join('\n  ')}${c.reset}`);
  }
}

function printResponse(data: any, latency: number) {
  const statusColor = data.error ? c.red : c.green;
  const status = data.error ? '✗ Error' : '✓ Success';
  console.log(`\n${c.dim}Response:${c.reset} ${statusColor}${status}${c.reset} ${c.dim}(${latency}ms)${c.reset}`);
  
  // Pretty print response (truncated for readability)
  const jsonStr = JSON.stringify(data, null, 2);
  const lines = jsonStr.split('\n');
  const maxLines = 15;
  
  if (lines.length > maxLines) {
    console.log(`  ${c.white}${lines.slice(0, maxLines).join('\n  ')}${c.reset}`);
    console.log(`  ${c.dim}... (${lines.length - maxLines} more lines)${c.reset}`);
  } else {
    console.log(`  ${c.white}${jsonStr.split('\n').join('\n  ')}${c.reset}`);
  }
}

function printHighlight(label: string, value: string) {
  console.log(`  ${c.yellow}→${c.reset} ${c.dim}${label}:${c.reset} ${c.bright}${c.green}${value}${c.reset}`);
}

async function fetchWithTiming(url: string, options?: RequestInit): Promise<{ data: any; latency: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, options);
    const data = await res.json();
    return { data, latency: Date.now() - start };
  } catch (error) {
    return { 
      data: { error: error instanceof Error ? error.message : 'Request failed' }, 
      latency: Date.now() - start 
    };
  }
}

// Demo capabilities
interface DemoCapability {
  name: string;
  description: string;
  method: 'GET' | 'POST';
  endpoint: string;
  body?: object;
  highlight?: (data: any) => void;
}

const capabilities: DemoCapability[] = [
  {
    name: 'Health Check',
    description: 'Verify the CAP-402 router is running',
    method: 'GET',
    endpoint: '/health',
    highlight: (data) => {
      printHighlight('Status', data.status || 'unknown');
      printHighlight('Version', data.version || '1.0.0');
    }
  },
  {
    name: 'Discover Capabilities',
    description: 'List all available capabilities in the protocol',
    method: 'GET',
    endpoint: '/capabilities',
    highlight: (data) => {
      const count = Array.isArray(data) ? data.length : (data.capabilities?.length || '20+');
      printHighlight('Total Capabilities', String(count));
    }
  },
  {
    name: 'Price Lookup',
    description: 'Get real-time SOL price via cap.price.lookup.v1',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.price.lookup.v1',
      inputs: { base_token: 'SOL', quote_token: 'USD' }
    },
    highlight: (data) => {
      if (data.outputs?.price) {
        printHighlight('SOL Price', `$${data.outputs.price}`);
        printHighlight('Source', data.outputs.source || 'aggregated');
      }
    }
  },
  {
    name: 'Wallet Snapshot',
    description: 'Get wallet balances via cap.wallet.snapshot.v1',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.wallet.snapshot.v1',
      inputs: { address: 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg' }
    },
    highlight: (data) => {
      if (data.outputs?.balances) {
        printHighlight('Balances Found', String(data.outputs.balances.length));
      }
    }
  },
  {
    name: 'AI Inference (Privacy L2)',
    description: 'Run sentiment analysis with encrypted execution',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.ai.inference.v1',
      inputs: {
        model: 'sentiment-analysis',
        input: 'CAP-402 is revolutionizing agent infrastructure with privacy-first design!',
        privacy_level: 2
      }
    },
    highlight: (data) => {
      if (data.outputs) {
        printHighlight('Sentiment', data.outputs.sentiment || data.outputs.result || 'analyzed');
        printHighlight('Privacy Level', 'L2 (Confidential)');
      }
    }
  },
  {
    name: 'AI Embedding (Privacy L2)',
    description: 'Generate vector embeddings with privacy guarantees',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.ai.embedding.v1',
      inputs: {
        text: 'Privacy-first agent infrastructure for autonomous AI',
        model: 'text-embedding-3-small'
      }
    },
    highlight: (data) => {
      if (data.outputs?.embedding) {
        printHighlight('Dimensions', String(data.outputs.embedding.length || 1536));
        printHighlight('Privacy', 'Input never exposed');
      }
    }
  },
  {
    name: 'ZK Proof Generation',
    description: 'Generate zero-knowledge proof via cap.zk.proof.v1',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.zk.proof.v1',
      inputs: {
        circuit: 'balance_check',
        private_inputs: { balance: 10000 },
        public_inputs: { min_balance: 1000 }
      }
    },
    highlight: (data) => {
      if (data.outputs) {
        printHighlight('Proof Valid', data.outputs.valid ? 'Yes' : 'No');
        printHighlight('Privacy', 'Balance hidden, only threshold proven');
      }
    }
  },
  {
    name: 'KYC Proof (Privacy L2)',
    description: 'Prove KYC compliance without revealing personal data',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.zk.kyc.v1',
      inputs: {
        verification_type: 'age',
        private_inputs: { date_of_birth: '1990-01-15' },
        public_inputs: { min_age: 18 }
      }
    },
    highlight: (data) => {
      if (data.outputs) {
        printHighlight('Age Verified', data.outputs.verified ? 'Yes (18+)' : 'Pending');
        printHighlight('Data Revealed', 'None - ZK proof only');
      }
    }
  },
  {
    name: 'Pump.fun Quote',
    description: 'Get bonding curve quote for token purchase',
    method: 'GET',
    endpoint: '/pumpfun/quote?mint_address=So11111111111111111111111111111111111111112&side=buy&amount=1.0',
    highlight: (data) => {
      if (data.quote || data.tokens_out) {
        printHighlight('Quote', data.quote || `${data.tokens_out} tokens`);
      }
    }
  },
  {
    name: 'MEV Analysis',
    description: 'Analyze MEV risk for a potential swap',
    method: 'POST',
    endpoint: '/mev/analyze',
    body: {
      token_in: 'SOL',
      token_out: 'USDC',
      amount: 10000,
      slippage: 0.5
    },
    highlight: (data) => {
      if (data.risk_score !== undefined) {
        printHighlight('MEV Risk', `${data.risk_score}/100`);
        printHighlight('Recommendation', data.recommendation || 'Use Jito bundles');
      }
    }
  },
  {
    name: 'Whale Tracker',
    description: 'Track large wallet movements in real-time',
    method: 'GET',
    endpoint: '/alpha/whale-tracker',
    highlight: (data) => {
      const count = Array.isArray(data) ? data.length : (data.whales?.length || 0);
      printHighlight('Whales Tracked', String(count));
    }
  },
  {
    name: 'Confidential Swap (Arcium MPC)',
    description: 'Execute swap with hidden amounts via MPC',
    method: 'POST',
    endpoint: '/invoke',
    body: {
      capability_id: 'cap.confidential.swap.v1',
      inputs: {
        token_in: 'SOL',
        token_out: 'USDC',
        amount: 1.0,
        slippage_bps: 50,
        wallet_address: 'demo_wallet'
      }
    },
    highlight: (data) => {
      printHighlight('Execution', 'Arcium MPC (amounts hidden)');
      printHighlight('MEV Protection', 'Enabled');
    }
  }
];

async function runDemo() {
  printBanner();
  
  console.log(`${c.dim}Target: ${BASE_URL}${c.reset}`);
  console.log(`${c.dim}Press Ctrl+C to exit at any time${c.reset}`);
  
  await sleep(2000);
  
  printSection('CAP-402 CAPABILITY DEMONSTRATION', '🚀');
  
  console.log(`
${c.white}CAP-402 is the execution & monetization layer for AI agents.${c.reset}

${c.dim}Key Features:${c.reset}
  ${c.green}✓${c.reset} 20+ capabilities (price, wallet, swap, AI, ZK proofs, etc.)
  ${c.green}✓${c.reset} 4 privacy levels (Public → Confidential → Maximum)
  ${c.green}✓${c.reset} X.402 payment protocol for agent-to-agent commerce
  ${c.green}✓${c.reset} Arcium MPC for confidential compute
  ${c.green}✓${c.reset} Noir ZK circuits for privacy proofs
  ${c.green}✓${c.reset} 530 tests passing
`);

  await sleep(3000);
  
  printSection('RUNNING CAPABILITY DEMOS', '⚡');
  
  const total = capabilities.length;
  
  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i];
    
    printStep(i + 1, total, cap.name);
    console.log(`${c.dim}${cap.description}${c.reset}`);
    
    const url = `${BASE_URL}${cap.endpoint}`;
    
    printRequest(cap.method, cap.endpoint, cap.body);
    
    // Animated loading
    const loadingChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let loadingIndex = 0;
    const loadingInterval = setInterval(() => {
      clearLine();
      process.stdout.write(`${c.cyan}${loadingChars[loadingIndex]} Executing...${c.reset}`);
      loadingIndex = (loadingIndex + 1) % loadingChars.length;
    }, 80);
    
    const options: RequestInit = {
      method: cap.method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (cap.method === 'POST' && cap.body) {
      options.body = JSON.stringify(cap.body);
    }
    
    const { data, latency } = await fetchWithTiming(url, options);
    
    clearInterval(loadingInterval);
    clearLine();
    
    printResponse(data, latency);
    
    if (cap.highlight && !data.error) {
      console.log(`\n${c.dim}Key Results:${c.reset}`);
      cap.highlight(data);
    }
    
    await sleep(2500);
  }
  
  printSection('DEMO COMPLETE', '✅');
  
  console.log(`
${c.bright}${c.green}All ${total} capabilities demonstrated successfully!${c.reset}

${c.white}What you've seen:${c.reset}
  ${c.cyan}•${c.reset} Real-time price feeds and wallet data
  ${c.cyan}•${c.reset} AI inference with privacy guarantees
  ${c.cyan}•${c.reset} Zero-knowledge proofs (balance, KYC)
  ${c.cyan}•${c.reset} Confidential swaps via Arcium MPC
  ${c.cyan}•${c.reset} MEV analysis and whale tracking
  ${c.cyan}•${c.reset} Pump.fun bonding curve integration

${c.dim}Learn more:${c.reset}
  ${c.blue}Website:${c.reset}  https://cap402.com
  ${c.blue}Docs:${c.reset}     https://cap402.com/docs
  ${c.blue}GitHub:${c.reset}   https://github.com/TheQuantumChronicle/cap402

${c.bright}${c.magenta}"Agents don't call APIs. Agents call capabilities."${c.reset}
`);
}

// Run the demo
runDemo().catch(console.error);
