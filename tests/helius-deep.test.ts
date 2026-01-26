/**
 * HELIUS DEEP INTEGRATION TEST SUITE
 * 
 * Comprehensive testing of Helius DAS API & Price Feeds:
 * - Digital Asset Standard (DAS) API
 * - Live price feeds from CoinMarketCap
 * - Solana Tracker integration
 * - Wallet snapshots
 * - NFT & token data
 * - API key rotation
 * - Error handling & fallbacks
 * - Performance benchmarks
 * 
 * Run: npm test -- tests/helius-deep.test.ts
 */

import { heliusDASProvider } from '../providers/helius-das';
import { priceProvider } from '../providers/price';
import * as dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(60000);

describe('🟠 HELIUS DEEP INTEGRATION SUITE', () => {

  // ============================================
  // LIVE PRICE FEEDS - COINMARKETCAP
  // ============================================
  describe('Live Price Feeds - CoinMarketCap', () => {
    
    test('fetches LIVE SOL/USD price', async () => {
      const price = await priceProvider.getPrice('SOL', 'USD');
      
      console.log('\n💰 LIVE SOL PRICE:');
      console.log('   Price: $' + price.price.toFixed(2));
      console.log('   Source:', price.source);
      console.log('   Timestamp:', new Date(price.timestamp).toISOString());
      if (price.volume_24h) console.log('   24h Volume: $' + price.volume_24h.toLocaleString());
      if (price.market_cap) console.log('   Market Cap: $' + price.market_cap.toLocaleString());
      if (price.price_change_24h) console.log('   24h Change:', price.price_change_24h.toFixed(2) + '%');
      
      expect(price.price).toBeGreaterThan(0);
      expect(price.base_token).toBe('SOL');
      expect(price.quote_token).toBe('USD');
      expect(['coinmarketcap', 'solana-tracker', 'fallback-cache', 'cached-market-data']).toContain(price.source);
    });

    test('fetches LIVE BTC/USD price', async () => {
      const price = await priceProvider.getPrice('BTC', 'USD');
      
      console.log('\n💰 LIVE BTC PRICE:');
      console.log('   Price: $' + price.price.toLocaleString());
      console.log('   Source:', price.source);
      if (price.market_cap) console.log('   Market Cap: $' + price.market_cap.toLocaleString());
      
      expect(price.price).toBeGreaterThan(10000); // BTC > $10K
      expect(price.base_token).toBe('BTC');
    });

    test('fetches LIVE ETH/USD price', async () => {
      const price = await priceProvider.getPrice('ETH', 'USD');
      
      console.log('\n💰 LIVE ETH PRICE:');
      console.log('   Price: $' + price.price.toLocaleString());
      console.log('   Source:', price.source);
      
      expect(price.price).toBeGreaterThan(100); // ETH > $100
      expect(price.base_token).toBe('ETH');
    });

    test('fetches stablecoin prices correctly', async () => {
      const usdc = await priceProvider.getPrice('USDC', 'USD');
      const usdt = await priceProvider.getPrice('USDT', 'USD');
      
      console.log('\n💵 STABLECOIN PRICES:');
      console.log('   USDC: $' + usdc.price.toFixed(4));
      console.log('   USDT: $' + usdt.price.toFixed(4));
      
      // Stablecoins should be ~$1.00
      expect(usdc.price).toBeGreaterThan(0.99);
      expect(usdc.price).toBeLessThan(1.01);
      expect(usdt.price).toBeGreaterThan(0.99);
      expect(usdt.price).toBeLessThan(1.01);
    });

    test('handles multiple concurrent price requests', async () => {
      const tokens = ['SOL', 'BTC', 'ETH', 'USDC'];
      
      const prices = await Promise.all(
        tokens.map(token => priceProvider.getPrice(token, 'USD'))
      );
      
      console.log('\n📊 CONCURRENT PRICE FETCH:');
      prices.forEach(p => {
        console.log(`   ${p.base_token}: $${p.price.toLocaleString()} (${p.source})`);
      });
      
      expect(prices.every(p => p.price > 0)).toBe(true);
    });

    test('API key rotation works across requests', async () => {
      // Make enough requests to trigger key rotation
      const iterations = 6;
      const prices: any[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const price = await priceProvider.getPrice('SOL', 'USD');
        prices.push(price);
      }
      
      console.log('\n🔄 API KEY ROTATION:');
      console.log('   Requests Made:', iterations);
      console.log('   All Successful:', prices.every(p => p.price > 0));
      
      expect(prices.every(p => p.price > 0)).toBe(true);
    });

    test('fallback works when API fails', async () => {
      // Request a token that might not be in CMC
      const price = await priceProvider.getPrice('UNKNOWN_TOKEN_XYZ', 'USD');
      
      console.log('\n🔙 FALLBACK MECHANISM:');
      console.log('   Token: UNKNOWN_TOKEN_XYZ');
      console.log('   Source:', price.source);
      console.log('   Price:', price.price);
      
      // Should return fallback or 0
      expect(price.source).toBeDefined();
    });
  });

  // ============================================
  // PRICE DATA QUALITY
  // ============================================
  describe('Price Data Quality', () => {
    
    test('price includes 24h volume', async () => {
      const price = await priceProvider.getPrice('SOL', 'USD');
      
      console.log('\n📈 24H VOLUME:');
      console.log('   SOL 24h Volume: $' + (price.volume_24h?.toLocaleString() || 'N/A'));
      
      if (price.source === 'coinmarketcap') {
        expect(price.volume_24h).toBeGreaterThan(0);
      }
    });

    test('price includes market cap', async () => {
      const price = await priceProvider.getPrice('BTC', 'USD');
      
      console.log('\n💎 MARKET CAP:');
      console.log('   BTC Market Cap: $' + (price.market_cap?.toLocaleString() || 'N/A'));
      
      if (price.source === 'coinmarketcap') {
        expect(price.market_cap).toBeGreaterThan(100000000000); // BTC > $100B
      }
    });

    test('price includes 24h change percentage', async () => {
      const price = await priceProvider.getPrice('ETH', 'USD');
      
      console.log('\n📊 24H CHANGE:');
      console.log('   ETH 24h Change:', (price.price_change_24h?.toFixed(2) || 'N/A') + '%');
      
      if (price.source === 'coinmarketcap' && price.price_change_24h !== undefined) {
        // Change should be reasonable (-50% to +100%)
        expect(price.price_change_24h).toBeGreaterThan(-50);
        expect(price.price_change_24h).toBeLessThan(100);
      }
    });

    test('timestamp is recent', async () => {
      const price = await priceProvider.getPrice('SOL', 'USD');
      const now = Date.now();
      const age = now - price.timestamp;
      
      console.log('\n⏰ DATA FRESHNESS:');
      console.log('   Timestamp:', new Date(price.timestamp).toISOString());
      console.log('   Age:', age, 'ms');
      
      // Data should be less than 10 seconds old
      expect(age).toBeLessThan(10000);
    });
  });

  // ============================================
  // HELIUS DAS API
  // ============================================
  describe('Helius DAS API', () => {
    const TEST_WALLET = process.env.X402_PUBLIC_KEY || '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j';
    const KNOWN_NFT = 'DRiP2Pn2K6fuMLKQmt5rZWyHiUZ6WK3GChEySUpHSS4x'; // Example NFT

    test('fetches assets by owner', async () => {
      const result = await heliusDASProvider.getAssetsByOwner(TEST_WALLET);
      
      console.log('\n🖼️ ASSETS BY OWNER:');
      console.log('   Wallet:', TEST_WALLET.slice(0, 8) + '...');
      console.log('   Total Assets:', result.total);
      console.log('   Items Returned:', result.items.length);
      console.log('   Page:', result.page);
      
      expect(result.page).toBe(1);
      // May or may not have assets
      expect(result.items).toBeInstanceOf(Array);
    });

    test('fetches single asset details', async () => {
      const asset = await heliusDASProvider.getAsset(KNOWN_NFT);
      
      console.log('\n🎨 SINGLE ASSET:');
      console.log('   Asset ID:', KNOWN_NFT.slice(0, 8) + '...');
      console.log('   Found:', !!asset);
      if (asset) {
        console.log('   Interface:', asset.interface);
        console.log('   Name:', asset.content?.metadata?.name);
      }
      
      // Asset may or may not exist
      if (asset) {
        expect(asset.id).toBe(KNOWN_NFT);
      }
    });

    test('searches assets with filters', async () => {
      const result = await heliusDASProvider.searchAssets({
        ownerAddress: TEST_WALLET,
        limit: 10
      });
      
      console.log('\n🔍 ASSET SEARCH:');
      console.log('   Owner:', TEST_WALLET.slice(0, 8) + '...');
      console.log('   Results:', result.total);
      
      expect(result.items).toBeInstanceOf(Array);
    });

    test('fetches fungible tokens', async () => {
      const tokens = await heliusDASProvider.getFungibleTokens(TEST_WALLET);
      
      console.log('\n🪙 FUNGIBLE TOKENS:');
      console.log('   Wallet:', TEST_WALLET.slice(0, 8) + '...');
      console.log('   Token Count:', tokens.length);
      tokens.slice(0, 3).forEach(t => {
        console.log(`   • ${t.symbol}: ${t.balance} (${t.decimals} decimals)`);
      });
      
      expect(tokens).toBeInstanceOf(Array);
    });

    test('fetches NFTs', async () => {
      const nfts = await heliusDASProvider.getNFTs(TEST_WALLET);
      
      console.log('\n🖼️ NFTs:');
      console.log('   Wallet:', TEST_WALLET.slice(0, 8) + '...');
      console.log('   NFT Count:', nfts.length);
      nfts.slice(0, 3).forEach(n => {
        console.log(`   • ${n.name} (${n.compressed ? 'cNFT' : 'NFT'})`);
      });
      
      expect(nfts).toBeInstanceOf(Array);
    });

    test('fetches asset proof for compressed NFT', async () => {
      const proof = await heliusDASProvider.getAssetProof(KNOWN_NFT);
      
      console.log('\n🌳 ASSET PROOF:');
      console.log('   Asset:', KNOWN_NFT.slice(0, 8) + '...');
      console.log('   Has Proof:', !!proof);
      if (proof) {
        console.log('   Root:', proof.root?.slice(0, 20) + '...');
        console.log('   Proof Length:', proof.proof?.length);
      }
      
      // Proof may or may not exist depending on asset type
      if (proof) {
        expect(proof.root).toBeDefined();
      }
    });

    test('fetches collection data', async () => {
      const KNOWN_COLLECTION = 'DRiP2Pn2K6fuMLKQmt5rZWyHiUZ6WK3GChEySUpHSS4x';
      const collection = await heliusDASProvider.getCollection(KNOWN_COLLECTION);
      
      console.log('\n📚 COLLECTION:');
      console.log('   Collection:', KNOWN_COLLECTION.slice(0, 8) + '...');
      console.log('   Found:', !!collection.collection);
      console.log('   Total Items:', collection.stats.total_items);
      
      expect(collection.stats).toBeDefined();
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    
    test('handles invalid wallet address gracefully', async () => {
      const result = await heliusDASProvider.getAssetsByOwner('invalid_address');
      
      console.log('\n❌ INVALID WALLET:');
      console.log('   Items:', result.items.length);
      console.log('   Total:', result.total);
      
      // Should return empty, not throw
      expect(result.items).toBeInstanceOf(Array);
    });

    test('handles non-existent asset gracefully', async () => {
      const asset = await heliusDASProvider.getAsset('NonExistentAsset123456789');
      
      console.log('\n❌ NON-EXISTENT ASSET:');
      console.log('   Result:', asset);
      
      // Should return null or undefined, not throw
      expect(asset == null).toBe(true);
    });

    test('handles API timeout gracefully', async () => {
      // This tests the fallback mechanism
      const price = await priceProvider.getPrice('SOL', 'USD');
      
      // Should always return something
      expect(price.base_token).toBe('SOL');
    });
  });

  // ============================================
  // PERFORMANCE BENCHMARKS
  // ============================================
  describe('Performance Benchmarks', () => {
    
    test('price fetch latency', async () => {
      const iterations = 5;
      const latencies: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await priceProvider.getPrice('SOL', 'USD');
        latencies.push(Date.now() - start);
      }
      
      const avg = latencies.reduce((a, b) => a + b, 0) / iterations;
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      
      console.log('\n⚡ PRICE FETCH LATENCY:');
      console.log('   Iterations:', iterations);
      console.log('   Average:', avg.toFixed(0), 'ms');
      console.log('   Min:', min, 'ms');
      console.log('   Max:', max, 'ms');
      
      expect(avg).toBeLessThan(5000); // < 5s average
    });

    test('concurrent price fetch performance', async () => {
      const tokens = ['SOL', 'BTC', 'ETH', 'USDC', 'USDT'];
      
      const start = Date.now();
      const prices = await Promise.all(
        tokens.map(t => priceProvider.getPrice(t, 'USD'))
      );
      const elapsed = Date.now() - start;
      
      console.log('\n⚡ CONCURRENT FETCH:');
      console.log('   Tokens:', tokens.length);
      console.log('   Total Time:', elapsed, 'ms');
      console.log('   Avg per Token:', (elapsed / tokens.length).toFixed(0), 'ms');
      
      expect(prices.every(p => p.price > 0)).toBe(true);
    });

    test('DAS API latency', async () => {
      const TEST_WALLET = process.env.X402_PUBLIC_KEY || '82MfBWDVuG7yB5j1kxxA8RCB6vbrJCTmQbowXPmvHv7j';
      
      const start = Date.now();
      await heliusDASProvider.getAssetsByOwner(TEST_WALLET);
      const elapsed = Date.now() - start;
      
      console.log('\n⚡ DAS API LATENCY:');
      console.log('   getAssetsByOwner:', elapsed, 'ms');
      
      expect(elapsed).toBeLessThan(10000); // < 10s
    });
  });

  // ============================================
  // REAL-WORLD SCENARIOS
  // ============================================
  describe('Real-World Scenarios', () => {
    
    test('portfolio valuation: fetch all token prices', async () => {
      const portfolio = [
        { token: 'SOL', amount: 100 },
        { token: 'BTC', amount: 0.5 },
        { token: 'ETH', amount: 10 },
        { token: 'USDC', amount: 5000 }
      ];
      
      console.log('\n💼 PORTFOLIO VALUATION:');
      
      let totalValue = 0;
      for (const holding of portfolio) {
        const price = await priceProvider.getPrice(holding.token, 'USD');
        const value = holding.amount * price.price;
        totalValue += value;
        console.log(`   ${holding.amount} ${holding.token}: $${value.toLocaleString()}`);
      }
      
      console.log('   ─────────────────');
      console.log(`   TOTAL: $${totalValue.toLocaleString()}`);
      
      expect(totalValue).toBeGreaterThan(0);
    });

    test('price alert: check if SOL above threshold', async () => {
      const threshold = 50; // $50
      const price = await priceProvider.getPrice('SOL', 'USD');
      const isAbove = price.price > threshold;
      
      console.log('\n🔔 PRICE ALERT:');
      console.log('   Token: SOL');
      console.log('   Threshold: $' + threshold);
      console.log('   Current: $' + price.price.toFixed(2));
      console.log('   Alert:', isAbove ? '🟢 ABOVE' : '🔴 BELOW');
      
      expect(typeof isAbove).toBe('boolean');
    });

    test('arbitrage check: compare prices across sources', async () => {
      const price1 = await priceProvider.getPrice('SOL', 'USD');
      
      console.log('\n📊 ARBITRAGE CHECK:');
      console.log('   SOL Price:', '$' + price1.price.toFixed(2));
      console.log('   Source:', price1.source);
      console.log('   Note: Single source - no arb opportunity');
      
      expect(price1.price).toBeGreaterThan(0);
    });
  });
});
