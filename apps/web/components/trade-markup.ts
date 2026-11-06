// Trusted static builder markup. User content is rendered by validated controllers.
export const tradeMarkup = `
<main>
    <section class="page-heading">
      <div><p class="eyebrow">YOUR STRATEGY WORKSHOP</p><h1>Run your strategy.</h1><p class="subheading">Load an unlocked strategy, set your limits, and monitor its live price targets.</p></div>
      <div class="heading-actions"><button id="ai-open" class="api-key-button" type="button" aria-label="Add 0G API key" aria-haspopup="dialog" aria-controls="ai-dialog" title="API key and AI tools"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/><path d="m11.3 11.3 9.2 9.2m-3-3 2.5-2.5m-5 0 2.5-2.5"/></svg></button><button id="load-example" class="button secondary">Load example</button><button id="new-strategy" class="button primary"><span aria-hidden="true">＋</span> New strategy</button></div>
    </section>
    <section class="workspace" aria-label="Strategy builder">
      <aside class="palette panel" aria-label="Block palette">

        <section class="live-prices" aria-labelledby="live-prices-title">
          <div class="panel-title"><h2 id="live-prices-title">Live prices</h2><span class="small-tag">USD</span></div>
          <p class="tiny muted">Chainlink USD prices. Flash availability is checked before execution.</p>
        <div id="live-prices-list" class="price-list" aria-label="Live crypto prices"></div><p id="live-prices-status" class="tiny muted" role="status">Loading live prices…</p>
        </section>
        <div class="panel-title"><h2>Building blocks</h2><span class="small-tag">3 TYPES</span></div>
        <p class="muted small">Drag onto the canvas, or click to add.</p>
        <button class="palette-block indicator" data-kind="signal.price" draggable="true"><span class="block-icon">∿</span><span><strong>Price range</strong><small>When the market meets a rule</small></span><span class="grip" aria-hidden="true">⠿</span></button>
        <button class="palette-block guard" data-kind="guard.risk" draggable="true"><span class="block-icon">◇</span><span><strong>Risk limit</strong><small>Keep each order within limits</small></span><span class="grip" aria-hidden="true">⠿</span></button>
        <button class="palette-block action" data-kind="action.intent" draggable="true"><span class="block-icon">⇄</span><span><strong>Buy / sell</strong><small>Describe the intended action</small></span><span class="grip" aria-hidden="true">⠿</span></button>
        <div class="how-to"><p class="eyebrow">A SIMPLE RECIPE</p><ol><li><span>01</span>Start with a price range.</li><li><span>02</span>Add a risk limit and an action.</li><li><span>03</span>Connect the right dot to the next left dot.</li><li><span>04</span>Adjust settings and validate.</li></ol></div>
        <div class="fixture-note"><span aria-hidden="true">◌</span><div><strong>Real prices, virtual funds</strong><p>Live Chainlink reference and Flash quotes. No history or warm-up. Virtual funds only.</p></div></div>
      </aside>
      <div class="editor-column">
        <div class="canvas-toolbar"><div><span class="canvas-symbol" aria-hidden="true">⌘</span><strong>Strategy canvas</strong></div><div class="view-switch" role="group" aria-label="View"><button id="canvas-view" class="active" aria-pressed="true">Canvas</button><button id="json-view" aria-pressed="false">JSON</button></div></div>
        <div class="canvas-runbar"><span id="execution-selected" class="tiny muted">Current draft · live monitoring / paper funds</span><div class="heading-actions"><button id="execution-start" class="button primary compact" type="button" aria-describedby="execution-help">Run strategy</button><button id="execution-stop" class="button secondary compact" type="button" disabled>Stop</button></div></div>
        <details class="execution-settings"><summary>Run settings <span class="small-tag">CHOOSE EXECUTION MODE</span></summary>
          <label class="field"><span>Execution mode</span><select id="execution-mode"><option value="LIVE">LIVE · 0G agent + connected wallet (real funds)</option><option value="AI" selected>0G execution agent · virtual funds</option><option value="RULES_ONLY">Local live-price monitor (no AI cost)</option></select></label>
          <div class="execution-limits">
            <label class="field"><span>Starting virtual cash / live buy spending cap (USD)</span><input id="execution-capital" type="number" value="1000" min="0.000001" max="1000000" step="0.000001"></label>
            <label class="field"><span>Total turnover limit, including fees (USD)</span><input id="execution-turnover" type="number" value="2000" min="0.000001" max="1000000" step="0.000001"></label>
            <label class="field"><span>Simulated fee (basis points)</span><input id="execution-fee" type="number" value="10" min="0" max="1000" step="1"></label>
            <label class="field"><span>Simulated slippage (basis points)</span><input id="execution-slippage" type="number" value="25" min="0" max="500" step="1"></label>
          </div><p class="tiny muted">100 basis points = 1%. Slippage must fit the strategy limit. Uses current prices and virtual funds. Each action executes once per run. Fees and fills are simulated.</p>
        </details>

        <p id="creator-text" class="tiny muted"></p>
        <p id="execution-help" class="run-help tiny muted"></p>
        <div id="canvas-viewport" class="canvas-viewport">
          <div id="canvas" class="canvas" aria-label="Strategy canvas drop area">
            <svg id="connections" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#9aa6b8"/></marker></defs><g id="edge-paths"></g></svg>
            <div id="empty-state" class="empty-state" hidden><span>＋</span><h3>Your idea starts here</h3><p>Drop an unlocked strategy here, or add a price range,<br>risk limit, and buy/sell block and connect them.</p></div>
          </div>
        </div>
        <div id="json-panel" class="json-panel" hidden><p class="muted small">Strategy rules only. Canvas positions are kept separately.</p><pre id="json-preview" tabindex="0" aria-label="Strategy JSON preview"></pre></div>
        <div class="canvas-footer"><span id="block-count">6 blocks · 4 connections</span><span>Move blocks with drag, or focus a block title and use arrow keys.</span></div>
        <section class="market-chart" aria-labelledby="market-chart-title">
          <div class="chart-heading"><div><p class="chart-eyebrow" id="market-chart-title">STRATEGY MARKET</p><h2 id="chart-pair">— / USD</h2><p id="chart-network" class="chart-muted"></p></div><div class="chart-price"><strong id="chart-last-price">—</strong><span id="chart-feed-status" data-state="loading">CONNECTING</span></div></div>
          <div class="chart-toolbar"><div class="chart-window" role="group" aria-label="Chart time range"><button type="button" data-chart-window="5" aria-pressed="false">5m</button><button type="button" data-chart-window="15" aria-pressed="true">15m</button><button type="button" data-chart-window="60" aria-pressed="false">1h</button></div><span class="chart-muted">Sampled 1m candles · 2s quote checks</span></div>
          <div id="chart-targets" class="chart-targets" aria-label="Strategy target ranges"></div>
          <div class="chart-plot"><svg id="market-chart-svg" class="market-chart-svg" viewBox="0 0 1000 360" role="img" aria-label="Live sampled candlestick chart with strategy targets and entry/exit markers"></svg></div>
          <div class="chart-caption"><span id="chart-hover">Move over the chart to inspect a price</span><span>▥ Sampled candles &nbsp; ▰ Target zone &nbsp; ▲ Entry / ▼ Exit</span></div>
          <p id="chart-observation" class="chart-muted chart-observation">Recent observations are cached in this browser. Flash quotes refresh in the background with Chainlink fallback.</p>
          <div class="chart-position-panel"><strong id="chart-position">No active position data</strong><span id="chart-pnl"></span><p id="chart-position-note">Start a strategy to see its position and entry/exit markers.</p></div>
          <div class="chart-agent"><div class="chart-agent-heading"><strong>Agent activity</strong><span id="chart-ai-count">0 completed AI executions in latest run</span></div><p id="chart-agent-status" role="status" aria-live="polite">Ready · start a strategy to monitor its targets.</p><ol id="chart-activity" class="chart-activity" aria-label="Recent agent activity"></ol></div>
        </section>
        <p id="execution-status" class="small" role="status" aria-live="polite"></p>
        <div id="execution-results" class="execution-results" aria-live="polite" hidden></div>
      </div>
      <aside class="library panel" aria-label="Your strategies and creators">
        <div class="library-nav" role="tablist" aria-label="Strategy library">
          <button id="tab-community" type="button" role="tab" data-library-tab="community" aria-controls="library-community" aria-selected="true">Community</button>
          <button id="tab-unlocked" type="button" role="tab" data-library-tab="unlocked" aria-controls="library-unlocked" aria-selected="false" tabindex="-1">Unlocked</button>
          <button id="tab-creators" type="button" role="tab" data-library-tab="creators" aria-controls="library-creators" aria-selected="false" tabindex="-1">Creators</button>
        </div>
        <section id="library-community" class="public-library" role="tabpanel" aria-labelledby="tab-community" tabindex="0">
          <h2 id="community-library-title">Communities</h2><p class="small muted">Choose a community to see its public strategies.</p>
          <button id="back-to-communities" class="button secondary" type="button" hidden>← Communities</button>
          <button id="refresh-community-strategies" class="button secondary" type="button">Refresh</button>
          <a id="community-page-link" class="small" href="/community#/communities">Open community page ↗</a>
          <div id="community-strategies" class="unlocked-cards"></div><button id="more-community-strategies" class="button secondary" type="button" hidden>Load more</button><p id="community-strategies-status" class="small muted" role="status"></p>
        </section>
        <section id="library-unlocked" role="tabpanel" aria-labelledby="tab-unlocked" tabindex="0" hidden>
        <div class="panel-title"><h2>Unlocked strategies</h2><span class="small-tag">YOUR LIBRARY</span></div>
        <p class="small muted">Drag onto the canvas, or click to load.</p>
        <div id="execution-library" class="unlocked-cards"></div>
        <form id="unlock-library-form" autocomplete="off"><label class="field"><span>Community recovery code</span><input id="library-recovery" type="password" required autocomplete="off"></label><button class="button secondary" type="submit">Unlock strategies</button></form>
        <button id="refresh-member-library" class="button secondary" type="button">Refresh memberships</button><button id="lock-library" class="button secondary" type="button">Lock</button>
        <p id="unlocked-status" class="small muted" role="status">Connect your community wallet to load purchased strategies.</p>
        </section>
        <section id="library-creators" role="tabpanel" aria-labelledby="tab-creators" tabindex="0" hidden>
        <h2>Your creators</h2>
        <p class="small muted">Creators whose paid memberships are active on the community page.</p>
        <button id="refresh-creator-library" class="button secondary" type="button">Refresh</button>
        <p id="creators-status" class="small muted" role="status"></p>
        <a href="#memberships">Manage memberships</a>
        <div id="creator-library" class="creator-list"></div>
        <p id="creators-empty" class="library-empty small muted">No active creator memberships to show yet.</p>
        </section>
      </aside>
    </section>
    <details id="memberships" class="membership-workspace panel"><summary>Memberships and exclusive strategies</summary><p>Connect your membership wallet to restore subscriptions. Unlock a creator feed, then drag a strategy onto the canvas.</p><div id="builder-memberships"></div></details>
    <footer class="page-footer"><p>Review your draft before publishing it publicly.</p><div><button id="publish-community" class="button primary">Publish to community</button><button id="import" class="button secondary">↑ Import JSON</button><button id="export" class="button secondary">↓ Export JSON</button></div></footer>
    <p id="notice" class="notice" role="status" aria-live="polite"></p>
  </main>
    <dialog id="ai-dialog" class="ai-dialog" aria-labelledby="ai-title">
      <div class="dialog-heading"><h2 id="ai-title">0G API key</h2><button id="ai-close" class="icon-button" type="button" aria-label="Close API key settings">×</button></div>
      <form id="ai-key-form" class="ai-key-row" autocomplete="off">
        <label class="field"><span>0G inference API key</span><input id="ai-key" type="password" autofocus autocomplete="off" spellcheck="false" autocapitalize="none" maxlength="243" placeholder="sk-…" aria-describedby="ai-key-status"></label>
        <button id="ai-use-key" class="button secondary" type="submit">Use key</button>
        <button id="ai-forget" class="button secondary" type="button" disabled>Forget key</button>
      </form>
      <p id="ai-key-status" class="muted small" role="status">Kept in this tab only. Closing this window keeps the saved key; reloading clears it.</p>
      <p class="muted small">Get a dedicated inference key from <a href="https://pc.0g.ai" target="_blank" rel="noopener noreferrer">0G Private Computer</a>. Requests are billed to your account and may use deposited funds. Set a key budget in 0G where available. The interpreter translates text; the separate execution agent follows the validated rules. Live mode uses real funds only after your wallet approval and signature.</p>
      <details class="ai-tools"><summary>Strategy interpreter</summary>
      <form id="ai-form">
        <label class="field"><span>AI action</span><select id="ai-operation"><option value="generate">Interpret creator text</option></select></label>
        <label class="field"><span>Creator’s strategy text</span><textarea id="ai-prompt" rows="3" maxlength="4000" required placeholder="On Base, buy $20 of WETH using USDC once when ETH/USD is between $2000 and $2100 inclusive."></textarea></label>
        <button id="ai-run" class="button primary" type="submit" disabled>Ask AI</button>
      </form>
      <p id="ai-status" class="small" role="status" aria-live="polite"></p>
      <div id="ai-result" class="ai-result" hidden>
        <p id="ai-metadata" class="muted tiny"></p><p id="ai-explanation" class="small"></p>
        <pre id="ai-draft" tabindex="0" aria-label="Proposed strategy JSON"></pre>
        <div class="heading-actions"><button id="ai-accept" class="button primary" type="button">Load interpreted rules</button><button id="ai-discard" class="button secondary" type="button">Dismiss</button></div>
      </div>
      </details>
    </dialog>
  <dialog id="strategy-settings" class="strategy-dialog" aria-labelledby="strategy-settings-title">
    <div class="dialog-heading"><h2 id="strategy-settings-title">Strategy settings</h2><button id="close-strategy-settings" class="icon-button" type="button" aria-label="Close strategy settings">×</button></div>
    <section id="validation" class="validation" aria-labelledby="validation-title" aria-live="polite" hidden>
      <h2 id="validation-title">Strategy needs changes</h2>
      <ul id="issues" class="issues" hidden></ul>
    </section>
    <div class="inspector panel">
        <label class="field"><span>Strategy name</span><input id="strategy-name" maxlength="100" autocomplete="off"></label>
        <div class="section-divider"></div>
        <div class="inspector-heading"><span class="eyebrow">SELECTED BLOCK</span><span id="selected-kind" class="muted small"></span></div>
        <div id="node-settings"></div>
        <button id="delete-node" class="delete-button" hidden>Remove block</button>
        <div class="section-divider"></div>
        <p class="eyebrow">ORDER LIMITS</p>
        <label class="field"><span>Maximum per order <span class="unit">USD</span></span><input id="max-notional" type="number" min="0.01" step="0.01"></label>
        <label class="field"><span>Maximum slippage <span class="unit">BPS</span></span><input id="max-slippage" type="number" min="0" max="500" step="1"></label>
        <p class="muted tiny">100 bps = 1%. These limits apply to every action.</p>
        <div class="paper-label"><span aria-hidden="true">▣</span> Paper-only strategy</div>
        <div class="section-divider"></div>
        <p class="eyebrow">CONNECTIONS</p><div id="connection-list" class="connection-list"></div>
    </div>
  </dialog>
  <dialog id="import-dialog" aria-labelledby="import-title">
    <form id="import-form"><div class="dialog-heading"><div><p class="eyebrow">BRING YOUR RULES</p><h2 id="import-title">Import a strategy</h2></div><button type="button" id="close-import" class="icon-button" aria-label="Close import">×</button></div>
      <p class="muted small">Paste strategy JSON or choose a file. It must pass validation before replacing your draft.</p>
      <label class="field"><span>Choose JSON file <span class="unit">64 KiB MAX</span></span><input id="json-file" type="file" accept=".json,application/json"></label>
      <label class="field"><span>Strategy JSON</span><textarea id="import-text" rows="12" spellcheck="false" placeholder='{"schemaVersion": "1", ...}'></textarea></label>
      <p id="import-error" class="import-error" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel-import" class="button secondary">Cancel</button><button type="submit" class="button primary">Import strategy</button></div>
    </form>
  </dialog>
`;
