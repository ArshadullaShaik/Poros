export function MarketChart() {
  return (
    <section className="market-chart" aria-label="Market chart">
          <div className="chart-heading"><div><h2 id="chart-pair">— / USD</h2><p id="chart-network" className="chart-muted"></p></div><div className="chart-price"><strong id="chart-last-price">—</strong><span id="chart-feed-status" data-state="loading">CONNECTING</span></div></div>
          <div className="chart-toolbar">
            <div className="chart-window" role="group" aria-label="Chart time range">{[['1','1 min'],['5','5 min'],['60','1Hr'],['1440','24H'],['43200','Month'],['ytd','YTD'],['max','MAX']].map(([value,label]) => <button key={value} type="button" data-chart-window={value} aria-pressed={value === '1440'}>{label}</button>)}</div>
            <label className="chart-style">Chart <select id="chart-style" defaultValue="candles"><option value="candles">Candles</option><option value="line">Line</option><option value="points">Points</option></select></label>
          </div>
          <div id="chart-summary" className="chart-summary" aria-label="Selected range price summary"></div>
          <div id="chart-targets" className="chart-targets" aria-label="Strategy target ranges"></div>
          <div className="chart-plot"><svg id="market-chart-svg" className="market-chart-svg" viewBox="0 0 1000 360" role="img" aria-label="Live candlestick chart with strategy targets and entry/exit markers"></svg></div>
          <div className="chart-caption"><span id="chart-hover">Move over the chart to inspect a price</span><span>▲ Entry · ▼ Exit</span></div>
          <p id="chart-observation" className="chart-muted chart-observation">Coinbase USD reference market · refreshes every 5 seconds.</p>
        </section>
  );
}

export function MarketActivity() {
  return (
    <aside className="market-activity" aria-label="Position and agent activity">
      <h2>Position</h2>
          <div className="chart-position-panel"><strong id="chart-position">No active position data</strong><span id="chart-pnl"></span><p id="chart-position-note">Start a strategy to see its position and entry/exit markers.</p></div>
          <div className="chart-agent"><div className="chart-agent-heading"><strong>Agent activity</strong><span id="chart-ai-count">0 completed AI executions in latest run</span></div><p id="chart-agent-status" role="status" aria-live="polite">Ready · start a strategy to monitor its targets.</p><ol id="chart-activity" className="chart-activity" aria-label="Recent agent activity"></ol></div>
    </aside>
  );
}
