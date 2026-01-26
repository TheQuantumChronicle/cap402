/**
 * AI Inference Capability Tests
 * Tests the new private AI inference and embedding capabilities
 */

import { aiInferenceProvider } from '../providers/ai-inference';

describe('🤖 AI Inference Provider', () => {
  describe('Sentiment Analysis', () => {
    test('analyzes positive sentiment', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'This is great and I love it! The best product ever, amazing quality!',
        2
      );

      expect(result.success).toBe(true);
      expect(result.model_used).toBe('sentiment-analysis');
      expect(result.privacy_level).toBe(2);
      expect(result.result).toBeDefined();
      expect(result.result.sentiment).toBe('positive');
      expect(result.result.confidence).toBeGreaterThan(0.5);
    });

    test('analyzes negative sentiment', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'This is terrible and bad, I hate it! The worst experience ever.',
        2
      );

      expect(result.success).toBe(true);
      expect(result.result.sentiment).toBe('negative');
    });

    test('analyzes neutral sentiment', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'The weather is cloudy today.',
        2
      );

      expect(result.success).toBe(true);
      expect(result.result.sentiment).toBe('neutral');
    });
  });

  describe('Classification', () => {
    test('classifies text', async () => {
      const result = await aiInferenceProvider.inference(
        'classification',
        'Sample text for classification',
        2
      );

      expect(result.success).toBe(true);
      expect(result.model_used).toBe('classification');
      expect(result.result.label).toBeDefined();
      expect(result.result.confidence).toBeGreaterThan(0);
      expect(result.result.all_labels).toBeInstanceOf(Array);
    });
  });

  describe('Summarization', () => {
    test('summarizes long text', async () => {
      const longText = 'This is a very long document that contains many important points about various topics. It discusses technology, finance, and other subjects in great detail. The document spans multiple paragraphs and covers a wide range of information.';
      
      const result = await aiInferenceProvider.inference(
        'summarization',
        longText,
        2
      );

      expect(result.success).toBe(true);
      expect(result.model_used).toBe('summarization');
      expect(result.result.summary).toBeDefined();
      expect(result.result.summary.length).toBeLessThan(longText.length);
      expect(result.result.key_points).toBeInstanceOf(Array);
    });
  });

  describe('Embeddings', () => {
    test('generates embeddings for single text', async () => {
      const result = await aiInferenceProvider.generateEmbeddings(
        ['Hello world'],
        'text-embedding-3-small',
        2
      );

      expect(result.success).toBe(true);
      expect(result.embeddings).toBeDefined();
      expect(result.embeddings!.length).toBe(1);
      expect(result.embeddings![0].length).toBe(1536);
      expect(result.dimensions).toBe(1536);
    });

    test('generates embeddings for multiple texts', async () => {
      const texts = ['First text', 'Second text', 'Third text'];
      const result = await aiInferenceProvider.generateEmbeddings(texts);

      expect(result.success).toBe(true);
      expect(result.embeddings!.length).toBe(3);
    });

    test('embeddings are normalized', async () => {
      const result = await aiInferenceProvider.generateEmbeddings(['Test text']);
      
      expect(result.success).toBe(true);
      const embedding = result.embeddings![0];
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1, 1); // Should be approximately 1 (normalized)
    });
  });

  describe('Privacy Levels', () => {
    test('respects privacy level 0 (public)', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'Test input',
        0
      );

      expect(result.success).toBe(true);
      expect(result.privacy_level).toBe(0);
    });

    test('respects privacy level 2 (confidential)', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'Test input',
        2
      );

      expect(result.success).toBe(true);
      expect(result.privacy_level).toBe(2);
      expect(result.proof).toBeDefined();
    });
  });

  describe('Output Encryption', () => {
    test('encrypts output when requested', async () => {
      const result = await aiInferenceProvider.inference(
        'sentiment-analysis',
        'Test input',
        2,
        undefined,
        true // encrypt_output
      );

      expect(result.success).toBe(true);
      expect(result.encrypted).toBe(true);
      expect(result.result.encrypted).toBe(true);
      expect(result.result.ciphertext).toBeDefined();
    });
  });

  describe('Stats Tracking', () => {
    test('tracks inference statistics', async () => {
      const initialStats = aiInferenceProvider.getStats();
      
      await aiInferenceProvider.inference('sentiment-analysis', 'Test', 0);
      
      const newStats = aiInferenceProvider.getStats();
      expect(newStats.totalInferences).toBeGreaterThan(initialStats.totalInferences);
    });
  });

  describe('Available Models', () => {
    test('lists available models', () => {
      const models = aiInferenceProvider.getAvailableModels();
      
      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'sentiment-analysis')).toBe(true);
      expect(models.some(m => m.id === 'classification')).toBe(true);
      expect(models.some(m => m.id === 'embeddings')).toBe(true);
    });
  });
});

describe('🔐 KYC Proof Capability', () => {
  test('KYC capability is registered', async () => {
    const { registry } = await import('../router/registry');
    const kycCap = registry.getCapability('cap.zk.kyc.v1');
    
    expect(kycCap).toBeDefined();
    expect(kycCap?.name).toBe('Private KYC Verification');
    expect(kycCap?.execution.mode).toBe('confidential');
  });

  test('Credential capability is registered', async () => {
    const { registry } = await import('../router/registry');
    const credCap = registry.getCapability('cap.zk.credential.v1');
    
    expect(credCap).toBeDefined();
    expect(credCap?.name).toBe('Private Credential Verification');
  });
});

describe('🤖 AI Capabilities Registration', () => {
  test('AI inference capability is registered', async () => {
    const { registry } = await import('../router/registry');
    const aiCap = registry.getCapability('cap.ai.inference.v1');
    
    expect(aiCap).toBeDefined();
    expect(aiCap?.name).toBe('Private AI Inference');
    expect(aiCap?.execution.mode).toBe('confidential');
    expect(aiCap?.metadata?.tags).toContain('ai');
  });

  test('AI embedding capability is registered', async () => {
    const { registry } = await import('../router/registry');
    const embCap = registry.getCapability('cap.ai.embedding.v1');
    
    expect(embCap).toBeDefined();
    expect(embCap?.name).toBe('Private Embeddings');
  });
});
