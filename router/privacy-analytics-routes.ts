/**
 * Privacy Analytics API Routes
 * Endpoints for privacy trend tracking and analysis
 */

import { Router, Request, Response } from 'express';
import { privacyAnalytics } from '../providers/privacy-analytics';

const router = Router();

/**
 * POST /privacy-analytics/track/start
 * Start tracking privacy trends for a token
 */
router.post('/track/start', async (req: Request, res: Response) => {
  try {
    const { mint_address, snapshot_interval_ms } = req.body;

    if (!mint_address || typeof mint_address !== 'string') {
      return res.status(400).json({ success: false, error: 'mint_address is required' });
    }

    if (mint_address.length < 32 || mint_address.length > 44) {
      return res.status(400).json({ success: false, error: 'Invalid mint_address format' });
    }

    const result = privacyAnalytics.startTracking(
      mint_address,
      snapshot_interval_ms || 60000
    );

    res.json({
      success: result.success,
      tracking: result.success,
      tracking_id: result.trackingId,
      mint_address,
      snapshot_interval_ms: snapshot_interval_ms || 60000
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Start tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /privacy-analytics/track/stop
 * Stop tracking privacy trends for a token
 */
router.post('/track/stop', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address is required' });
    }

    const stopped = privacyAnalytics.stopTracking(mint_address);

    res.json({
      success: true,
      stopped,
      mint_address
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Stop tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-analytics/trend/:mint_address
 * Get privacy trend analysis for a token
 */
router.get('/trend/:mint_address', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.params;
    const { since, limit } = req.query;

    const trend = privacyAnalytics.getTrend(mint_address, {
      since: since ? parseInt(since as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    if (!trend) {
      return res.status(404).json({
        success: false,
        error: 'No trend data found. Start tracking first with POST /privacy-analytics/track/start'
      });
    }

    res.json({
      success: true,
      mint_address,
      trend: {
        direction: trend.trend,
        averageScore: Math.round(trend.avgScore * 100) / 100,
        minScore: trend.minScore,
        maxScore: trend.maxScore,
        volatility: Math.round(trend.volatility * 100) / 100,
        dataPoints: trend.snapshots.length,
        trendStrength: trend.trendStrength,
        firstRecorded: trend.firstRecorded,
        lastUpdated: trend.lastUpdated
      }
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Get trend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-analytics/snapshots/:mint_address
 * Get privacy snapshots history for a token
 */
router.get('/snapshots/:mint_address', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.params;
    const { since, limit } = req.query;

    const trend = privacyAnalytics.getTrend(mint_address, {
      since: since ? parseInt(since as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    if (!trend) {
      return res.status(404).json({
        success: false,
        error: 'No snapshot data found. Start tracking first with POST /privacy-analytics/track/start'
      });
    }

    res.json({
      success: true,
      mint_address,
      count: trend.snapshots.length,
      snapshots: trend.snapshots.map(s => ({
        timestamp: s.timestamp,
        privacyScore: s.privacyScore,
        grade: s.grade,
        anonymityScore: s.anonymityScore,
        totalHolders: s.totalHolders,
        anonymousHolders: s.anonymousHolders,
        largestHolderPercent: s.largestHolderPercent,
        top10HoldersPercent: s.top10HoldersPercent,
        creatorRevealed: s.creatorRevealed,
        graduated: s.graduated
      }))
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Get snapshots error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-analytics/compare
 * Compare privacy metrics across multiple tokens
 */
router.get('/compare', async (req: Request, res: Response) => {
  try {
    const { mint_addresses } = req.query;

    if (!mint_addresses) {
      return res.status(400).json({
        success: false,
        error: 'mint_addresses query param required (comma-separated)'
      });
    }

    const addresses = (mint_addresses as string).split(',').map(a => a.trim());

    if (addresses.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'At least 2 mint addresses required for comparison'
      });
    }

    const analysis = privacyAnalytics.getComparativeAnalysis(addresses);

    res.json({
      success: true,
      ...analysis
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Compare error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-analytics/tracked/list
 * Get list of all tracked tokens
 */
router.get('/tracked/list', async (req: Request, res: Response) => {
  try {
    const tokens = privacyAnalytics.getTrackedTokens();

    res.json({
      success: true,
      count: tokens.length,
      tokens
    });
  } catch (error: any) {
    console.error('[PrivacyAnalytics API] Get tracked error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
