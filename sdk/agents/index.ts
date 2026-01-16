/**
 * CAP-402 Agent Templates
 * 
 * Pre-built agent templates for common use cases.
 */

export { TradingAgent, createTradingAgent, type TradingConfig, type PriceData, type TradeSignal, type TradeExecution, type Position } from './trading-agent';
export { MonitoringAgent, createMonitoringAgent, type MonitoringConfig, type WalletSnapshot, type ProtocolHealth, type Alert } from './monitoring-agent';
export { AnalyticsAgent, createAnalyticsAgent, type AnalyticsConfig, type DataSource, type DataPoint, type TimeSeries, type AnalyticsReport } from './analytics-agent';
