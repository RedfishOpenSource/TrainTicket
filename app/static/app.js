const form = document.getElementById('search-form');
const results = document.getElementById('results');
const strategyLabels = {
  direct: '直达购票',
  buy_longer: '买长坐短',
  split_ticket: '拆段购票',
  transfer: '换乘购票',
};
const strategyDescriptions = {
  direct: '当前区间可直接购买，优先级最高。',
  buy_longer: '当前区间无票，但可以买更长区间上车。',
  split_ticket: '拆成多个连续区间后，总体更容易买到。',
  transfer: '通过合理换乘组合，缩短等待并完成出行。',
};
let currentController = null;

function renderLoadingState() {
  results.innerHTML = `
    <article class="result-card loading">
      <div class="result-top">
        <div>
          <span class="badge">正在分析</span>
          <h3 class="result-title">正在计算最优购票路径...</h3>
          <p class="result-subtitle">系统正在比较直达、买长坐短、拆票和换乘方案。</p>
        </div>
        <div class="metrics">
          <div class="metric"><span>预计耗时</span><strong>--</strong></div>
          <div class="metric"><span>预计票价</span><strong>--</strong></div>
        </div>
      </div>
    </article>
  `;
}

function renderEmptyState(message) {
  results.innerHTML = `<article class="empty-card">${message}</article>`;
}

function renderPlans(plans) {
  results.innerHTML = plans.map((plan) => `
    <article class="result-card">
      <div class="result-top">
        <div>
          <span class="badge">${strategyLabels[plan.strategy] || plan.strategy}</span>
          <h3 class="result-title">${strategyLabels[plan.strategy] || plan.strategy}</h3>
          <p class="result-subtitle">${strategyDescriptions[plan.strategy] || '这是当前排序最优的购票策略。'}</p>
        </div>
        <div class="metrics">
          <div class="metric">
            <span>总耗时</span>
            <strong>${plan.total_travel_minutes} 分钟</strong>
          </div>
          <div class="metric">
            <span>总票价</span>
            <strong>¥${Number(plan.total_price).toFixed(1)}</strong>
          </div>
        </div>
      </div>
      <div class="segments">
        ${plan.segments.map((segment, index) => `
          <div class="segment">
            <div class="segment-index">${index + 1}</div>
            <div class="segment-route">
              <strong>${segment.train_number} · ${segment.board_station} → ${segment.alight_station}</strong>
              <span>${segment.seat_type} ｜ ${new Date(segment.depart_at).toLocaleString('zh-CN', { hour12: false })} - ${new Date(segment.arrive_at).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
            <div class="segment-meta">票价 ¥${Number(segment.price).toFixed(1)}</div>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

if (form && results) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    currentController?.abort();
    currentController = new AbortController();
    const payload = Object.fromEntries(new FormData(form).entries());
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '正在计算...';
    }
    renderLoadingState();

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: currentController.signal,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error('Request failed');
      }

      if (!data.plans || data.plans.length === 0) {
        renderEmptyState('没有找到可购买方案，请尝试调整日期或出发到达站。');
        return;
      }

      renderPlans(data.plans);
    } catch (error) {
      if (error.name !== 'AbortError') {
        renderEmptyState('查询失败，请稍后重试。');
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '查询最优方案';
      }
    }
  });
}
