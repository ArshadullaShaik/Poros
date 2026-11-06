export function MarketChart() {
  return (
    <section className="market-chart" aria-labelledby="market-chart-title">
          <div className="chart-heading"><div><p className="chart-eyebrow" id="market-chart-title">STRATEGY MARKET</p><h2 id="chart-pair">— / USD</h2><p id="chart-network" className="chart-muted"></p></div><div className="chart-price"><strong id="chart-last-price">—</strong><span id="chart-feed-status" data-state="loading">CONNECTING</span></div></div>
          <div className="chart-toolbar"><div className="chart-window" role="group" aria-label="Chart time range"><button type="button" data-chart-window="5" aria-pressed="false">5m</button><button type="button" data-chart-window="15" aria-pressed="true">15m</button><button type="button" data-chart-window="60" aria-pressed="false">1h</button></div><span className="chart-muted">Sampled 1m candles · 2s quote checks</span></div>
          <div id="chart-targets" className="chart-targets" aria-label="Strategy target ranges"></div>
          <div className="chart-plot"><svg id="market-chart-svg" className="market-chart-svg" viewBox="0 0 1000 360" role="img" aria-label="Live sampled candlestick chart with strategy targets and entry/exit markers"></svg></div>
          <div className="chart-caption"><span id="chart-hover">Move over the chart to inspect a price</span><span>▥ Sampled candles &nbsp; ▰ Target zone &nbsp; ▲ Entry / ▼ Exit</span></div>
          <p id="chart-observation" className="chart-muted chart-observation">Recent observations are cached in this browser. Flash quotes refresh in the background with Chainlink fallback.</p>
          <div className="chart-position-panel"><strong id="chart-position">No active position data</strong><span id="chart-pnl"></span><p id="chart-position-note">Start a strategy to see its position and entry/exit markers.</p></div>
          <div className="chart-agent"><div className="chart-agent-heading"><strong>Agent activity</strong><span id="chart-ai-count">0 completed AI executions in latest run</span></div><p id="chart-agent-status" role="status" aria-live="polite">Ready · start a strategy to monitor its targets.</p><ol id="chart-activity" className="chart-activity" aria-label="Recent agent activity"></ol></div>
        </section>
  );
}
