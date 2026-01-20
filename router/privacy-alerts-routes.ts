/**
 * Privacy Alert System API Routes
 * Endpoints for managing privacy monitoring and alerts
 */

import { Router, Request, Response } from 'express';
import { privacyAlertSystem, AlertConfig } from '../providers/privacy-alerts';

const router = Router();

/**
 * POST /privacy-alerts/monitor/start
 * Start monitoring a token for privacy alerts
 */
router.post('/monitor/start', async (req: Request, res: Response) => {
  try {
    const { mint_address, thresholds, webhook_url, poll_interval_ms } = req.body;

    if (!mint_address || typeof mint_address !== 'string') {
      return res.status(400).json({ success: false, error: 'mint_address is required' });
    }

    if (mint_address.length < 32 || mint_address.length > 44) {
      return res.status(400).json({ success: false, error: 'Invalid mint_address format' });
    }

    const config: AlertConfig = {
      mintAddress: mint_address,
      thresholds: thresholds || {},
      webhookUrl: webhook_url,
      pollIntervalMs: poll_interval_ms || 30000
    };

    const result = privacyAlertSystem.startMonitoring(config);

    res.json({
      ...result,
      mint_address,
      config: {
        thresholds: config.thresholds,
        poll_interval_ms: config.pollIntervalMs,
        webhook_configured: !!webhook_url
      }
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Start monitor error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /privacy-alerts/monitor/stop
 * Stop monitoring a token
 */
router.post('/monitor/stop', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.body;

    if (!mint_address) {
      return res.status(400).json({ success: false, error: 'mint_address is required' });
    }

    const stopped = privacyAlertSystem.stopMonitoring(mint_address);

    res.json({
      success: true,
      stopped,
      mint_address
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Stop monitor error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-alerts/:mint_address
 * Get alerts for a token
 */
router.get('/:mint_address', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.params;
    const { unacknowledged_only, severity, limit } = req.query;

    const alerts = privacyAlertSystem.getAlerts(mint_address, {
      unacknowledgedOnly: unacknowledged_only === 'true',
      severity: severity as any,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json({
      success: true,
      mint_address,
      count: alerts.length,
      alerts
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Get alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /privacy-alerts/acknowledge
 * Acknowledge an alert
 */
router.post('/acknowledge', async (req: Request, res: Response) => {
  try {
    const { alert_id } = req.body;

    if (!alert_id) {
      return res.status(400).json({ success: false, error: 'alert_id is required' });
    }

    const acknowledged = privacyAlertSystem.acknowledgeAlert(alert_id);

    if (!acknowledged) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }

    res.json({
      success: true,
      alert_id,
      acknowledged: true
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Acknowledge error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-alerts/:mint_address/stats
 * Get alert statistics for a token
 */
router.get('/:mint_address/stats', async (req: Request, res: Response) => {
  try {
    const { mint_address } = req.params;

    const stats = privacyAlertSystem.getAlertStats(mint_address);

    res.json({
      success: true,
      mint_address,
      stats
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Get stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /privacy-alerts/monitored
 * Get all monitored tokens
 */
router.get('/monitored/list', async (req: Request, res: Response) => {
  try {
    const tokens = privacyAlertSystem.getMonitoredTokens();

    res.json({
      success: true,
      count: tokens.length,
      tokens
    });
  } catch (error: any) {
    console.error('[PrivacyAlerts API] Get monitored error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
