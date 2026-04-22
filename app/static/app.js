const form = document.getElementById('search-form');
const results = document.getElementById('results');
const strategyLabels = {
  direct: '直达购票',
  buy_longer: '买长坐短',
  split_ticket: '拆段购票',
  transfer: '换乘购票',
};
let currentController = null;

if (form && results) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    currentController?.abort();
    currentController = new AbortController();
    const payload = Object.fromEntries(new FormData(form).entries());
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    results.innerHTML = '查询中...';

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: currentController.signal,
      });
      const data = await response.json();

      if (!data.plans || data.plans.length === 0) {
        results.innerHTML = '<div class="plan">没有找到可购买方案。</div>';
        return;
      }

      results.innerHTML = data.plans.map((plan) => `
        <div class="plan">
          <h2>${strategyLabels[plan.strategy] || plan.strategy}</h2>
          <p>总耗时：${plan.total_travel_minutes} 分钟</p>
          <p>总价：¥${plan.total_price}</p>
          <ul>
            ${plan.segments.map((segment) => `<li>${segment.train_number} ${segment.board_station} → ${segment.alight_station} (${segment.seat_type})</li>`).join('')}
          </ul>
        </div>
      `).join('');
    } catch (error) {
      if (error.name !== 'AbortError') {
        results.innerHTML = '<div class="plan">查询失败，请稍后重试。</div>';
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}
