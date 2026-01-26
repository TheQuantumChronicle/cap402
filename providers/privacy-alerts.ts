/**
 * Privacy Alert System for CAP-402 + StealthPump
 * 
 * Monitors privacy metrics and triggers alerts when thresholds are breached.
 * Features:
 * - Real-time anonymity monitoring
 * - Deanonymization risk detection
 * - Privacy score degradation alerts
 * - Webhook notifications
 * - Alert history and analytics
 */

import { pumpFunProvider } from './pumpfun';
import { eventBus } from './unified-privacy';

export interface PrivacyAlert {
  id: string;
  type: 'anonymity_breach' | 'privacy_degradation' | 'creator_exposure' | 'holder_concentration' | 'custom';
  severity: 'low' | 'medium' | 'high' | 'critical';
  mintAddress: string;
  timestamp: number;
  message: string;
  data: any;
  acknowledged: boolean;
  acknowledgedAt?: number;
}

export interface AlertThresholds {
  minAnonymityScore: number;           // Alert if anonymity score drops below this
  maxLargestHolderPercent: number;     // Alert if single holder exceeds this %
  maxTop10HoldersPercent: number;      // Alert if top 10 holders exceed this %
  minPrivacyScore: number;             // Alert if overall privacy score drops below this
  minHolderCount: number;              // Alert if holder count drops below this
}

export interface AlertConfig {
  mintAddress: string;
  thresholds: AlertThresholds;
  webhookUrl?: string;
  emailNotifications?: string[];
  pollIntervalMs?: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  minAnonymityScore: 50,
  maxLargestHolderPercent: 30,
  maxTop10HoldersPercent: 70,
  minPrivacyScore: 60,
  minHolderCount: 10
};

class PrivacyAlertSystem {
  private monitors: Map<string, NodeJS.Timeout> = new Map();
  private alerts: Map<string, PrivacyAlert[]> = new Map();
  private configs: Map<string, AlertConfig> = new Map();
  private alertIdCounter: number = 0;

  /**
   * Start monitoring a token for privacy alerts
   */
  startMonitoring(config: AlertConfig): { success: boolean; monitorId: string } {
    const { mintAddress, thresholds, pollIntervalMs = 30000 } = config;

    // Store config
    this.configs.set(mintAddress, {
      ...config,
      thresholds: { ...DEFAULT_THRESHOLDS, ...thresholds }
    });

    // If already monitoring, update config and return
    if (this.monitors.has(mintAddress)) {
      console.log(`[PrivacyAlerts] Updated config for ${mintAddress.slice(0, 8)}...`);
      return { success: true, monitorId: `alert_${mintAddress.slice(0, 8)}` };
    }

    // Start polling
    const monitor = setInterval(async () => {
      await this.checkPrivacyMetrics(mintAddress);
    }, pollIntervalMs);

    this.monitors.set(mintAddress, monitor);
    console.log(`[PrivacyAlerts] 🔔 Started monitoring ${mintAddress.slice(0, 8)}...`);

    return { success: true, monitorId: `alert_${mintAddress.slice(0, 8)}` };
  }

  /**
   * Stop monitoring a token
   */
  stopMonitoring(mintAddress: string): boolean {
    const monitor = this.monitors.get(mintAddress);
    if (monitor) {
      clearInterval(monitor);
      this.monitors.delete(mintAddress);
      this.configs.delete(mintAddress);
      console.log(`[PrivacyAlerts] 🔕 Stopped monitoring ${mintAddress.slice(0, 8)}...`);
      return true;
    }
    return false;
  }

  /**
   * Stop all monitors (cleanup)
   */
  stopAllMonitors(): void {
    for (const [mintAddress, monitor] of this.monitors.entries()) {
      clearInterval(monitor);
      console.log(`[PrivacyAlerts] 🔕 Stopped monitoring ${mintAddress.slice(0, 8)}...`);
    }
    this.monitors.clear();
    this.configs.clear();
    console.log('[PrivacyAlerts] All monitors stopped');
  }

  /**
   * Check privacy metrics and trigger alerts if needed
   */
  private async checkPrivacyMetrics(mintAddress: string): Promise<void> {
    try {
      const config = this.configs.get(mintAddress);
      if (!config) return;

      const { thresholds } = config;

      // Get current metrics
      const anonymityInfo = pumpFunProvider.getAnonymitySetInfo(mintAddress);
      const privacyScore = await pumpFunProvider.getPrivacyScore(mintAddress);

      // Check anonymity score
      if (anonymityInfo && anonymityInfo.anonymityScore < thresholds.minAnonymityScore) {
        this.createAlert({
          type: 'anonymity_breach',
          severity: anonymityInfo.anonymityScore < 30 ? 'critical' : 'high',
          mintAddress,
          message: `Anonymity score dropped to ${anonymityInfo.anonymityScore}% (threshold: ${thresholds.minAnonymityScore}%)`,
          data: {
            currentScore: anonymityInfo.anonymityScore,
            threshold: thresholds.minAnonymityScore,
            totalHolders: anonymityInfo.totalHolders,
            anonymousHolders: anonymityInfo.anonymousHolders
          }
        });
      }

      // Check holder concentration
      if (anonymityInfo && anonymityInfo.largestHolderPercent > thresholds.maxLargestHolderPercent) {
        this.createAlert({
          type: 'holder_concentration',
          severity: anonymityInfo.largestHolderPercent > 50 ? 'critical' : 'high',
          mintAddress,
          message: `Largest holder controls ${anonymityInfo.largestHolderPercent.toFixed(1)}% (threshold: ${thresholds.maxLargestHolderPercent}%)`,
          data: {
            largestHolderPercent: anonymityInfo.largestHolderPercent,
            threshold: thresholds.maxLargestHolderPercent,
            top10Percent: anonymityInfo.top10HoldersPercent
          }
        });
      }

      // Check top 10 holders concentration
      if (anonymityInfo && anonymityInfo.top10HoldersPercent > thresholds.maxTop10HoldersPercent) {
        this.createAlert({
          type: 'holder_concentration',
          severity: 'medium',
          mintAddress,
          message: `Top 10 holders control ${anonymityInfo.top10HoldersPercent.toFixed(1)}% (threshold: ${thresholds.maxTop10HoldersPercent}%)`,
          data: {
            top10Percent: anonymityInfo.top10HoldersPercent,
            threshold: thresholds.maxTop10HoldersPercent
          }
        });
      }

      // Check privacy score
      if (privacyScore.overallScore < thresholds.minPrivacyScore) {
        this.createAlert({
          type: 'privacy_degradation',
          severity: privacyScore.overallScore < 40 ? 'high' : 'medium',
          mintAddress,
          message: `Privacy score degraded to ${privacyScore.overallScore} (${privacyScore.grade}) - threshold: ${thresholds.minPrivacyScore}`,
          data: {
            currentScore: privacyScore.overallScore,
            grade: privacyScore.grade,
            threshold: thresholds.minPrivacyScore,
            factors: privacyScore.factors
          }
        });
      }

      // Check holder count
      if (anonymityInfo && anonymityInfo.totalHolders < thresholds.minHolderCount) {
        this.createAlert({
          type: 'anonymity_breach',
          severity: 'medium',
          mintAddress,
          message: `Low holder count: ${anonymityInfo.totalHolders} (threshold: ${thresholds.minHolderCount})`,
          data: {
            holderCount: anonymityInfo.totalHolders,
            threshold: thresholds.minHolderCount
          }
        });
      }

    } catch (error) {
      console.error(`[PrivacyAlerts] Error checking metrics for ${mintAddress.slice(0, 8)}:`, error);
    }
  }

  /**
   * Create and store an alert
   */
  private createAlert(params: Omit<PrivacyAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const alert: PrivacyAlert = {
      id: `alert_${++this.alertIdCounter}_${Date.now()}`,
      timestamp: Date.now(),
      acknowledged: false,
      ...params
    };

    // Store alert
    const alerts = this.alerts.get(params.mintAddress) || [];
    alerts.push(alert);
    this.alerts.set(params.mintAddress, alerts);

    // Emit event to event bus
    eventBus.emit('pumpfun', 'privacy_alert', {
      alert,
      mintAddress: params.mintAddress
    });

    // Send webhook if configured
    const config = this.configs.get(params.mintAddress);
    if (config?.webhookUrl) {
      this.sendWebhook(config.webhookUrl, alert).catch(err => {
        console.error('[PrivacyAlerts] Webhook error:', err);
      });
    }

    console.log(`[PrivacyAlerts] 🚨 ${alert.severity.toUpperCase()}: ${alert.message}`);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(url: string, alert: PrivacyAlert): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'privacy_alert',
          alert,
          timestamp: Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get alerts for a token
   */
  getAlerts(mintAddress: string, options?: { 
    unacknowledgedOnly?: boolean;
    severity?: PrivacyAlert['severity'];
    limit?: number;
  }): PrivacyAlert[] {
    let alerts = this.alerts.get(mintAddress) || [];

    if (options?.unacknowledgedOnly) {
      alerts = alerts.filter(a => !a.acknowledged);
    }

    if (options?.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }

    if (options?.limit) {
      alerts = alerts.slice(-options.limit);
    }

    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    for (const alerts of this.alerts.values()) {
      const alert = alerts.find(a => a.id === alertId);
      if (alert) {
        alert.acknowledged = true;
        alert.acknowledgedAt = Date.now();
        console.log(`[PrivacyAlerts] ✅ Acknowledged alert ${alertId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Get alert statistics
   */
  getAlertStats(mintAddress: string): {
    total: number;
    unacknowledged: number;
    bySeverity: Record<PrivacyAlert['severity'], number>;
    byType: Record<PrivacyAlert['type'], number>;
  } {
    const alerts = this.alerts.get(mintAddress) || [];
    
    const stats = {
      total: alerts.length,
      unacknowledged: alerts.filter(a => !a.acknowledged).length,
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      } as Record<PrivacyAlert['severity'], number>,
      byType: {
        anonymity_breach: 0,
        privacy_degradation: 0,
        creator_exposure: 0,
        holder_concentration: 0,
        custom: 0
      } as Record<PrivacyAlert['type'], number>
    };

    alerts.forEach(alert => {
      stats.bySeverity[alert.severity]++;
      stats.byType[alert.type]++;
    });

    return stats;
  }

  /**
   * Cleanup old alerts (prevent memory leak)
   */
  cleanupOldAlerts(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [mintAddress, alerts] of this.alerts.entries()) {
      const filtered = alerts.filter(a => now - a.timestamp < maxAgeMs);
      cleaned += alerts.length - filtered.length;
      
      if (filtered.length === 0) {
        this.alerts.delete(mintAddress);
      } else {
        this.alerts.set(mintAddress, filtered);
      }
    }

    if (cleaned > 0) {
      console.log(`[PrivacyAlerts] Cleaned up ${cleaned} old alerts`);
    }

    return cleaned;
  }

  /**
   * Get all monitored tokens
   */
  getMonitoredTokens(): string[] {
    return Array.from(this.monitors.keys());
  }
}

// Export singleton instance
export const privacyAlertSystem = new PrivacyAlertSystem();
