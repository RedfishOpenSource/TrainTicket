const form = document.getElementById('search-form');
const results = document.getElementById('results');
const stationFields = Array.from(document.querySelectorAll('[data-station-field]'));
const recommendationLabels = {
  shortest_duration: '最短耗时',
  cheapest_price: '最低票价',
  sleeper_priority: '卧铺优先',
};
const recommendationDescriptions = {
  shortest_duration: '优先压缩总耗时，适合赶时间时优先尝试。',
  cheapest_price: '优先比较总票价，适合控制预算时参考。',
  sleeper_priority: '优先选择含卧铺的方案，兼顾夜间乘坐体验。',
};
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(value) {
  return `¥${Number(value || 0).toFixed(1)}`;
}

function renderLoadingState() {
  results.innerHTML = `
    <article class="result-card loading">
      <div class="result-top">
        <div>
          <span class="badge">正在分析</span>
          <h3 class="result-title">正在计算推荐购票路径...</h3>
          <p class="result-subtitle">系统正在比较直达、买长坐短、拆票和换乘方案，并同步生成多维推荐。</p>
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
  results.innerHTML = `<article class="empty-card">${escapeHtml(message)}</article>`;
}

function renderPlanCard(plan, title, subtitle) {
  return `
    <article class="result-card">
      <div class="result-top">
        <div>
          <span class="badge">${escapeHtml(strategyLabels[plan.strategy] || plan.strategy)}</span>
          <h3 class="result-title">${escapeHtml(title || strategyLabels[plan.strategy] || plan.strategy)}</h3>
          <p class="result-subtitle">${escapeHtml(subtitle || strategyDescriptions[plan.strategy] || '这是当前排序最优的购票策略。')}</p>
        </div>
        <div class="metrics">
          <div class="metric">
            <span>总耗时</span>
            <strong>${escapeHtml(`${plan.total_travel_minutes} 分钟`)}</strong>
          </div>
          <div class="metric">
            <span>总票价</span>
            <strong>${escapeHtml(formatPrice(plan.total_price))}</strong>
          </div>
        </div>
      </div>
      <div class="segments">
        ${plan.segments.map((segment, index) => `
          <div class="segment">
            <div class="segment-index">${index + 1}</div>
            <div class="segment-route">
              <strong>${escapeHtml(`${segment.train_number} · ${segment.board_station} → ${segment.alight_station}`)}</strong>
              <span>${escapeHtml(`${segment.seat_type} ｜ ${formatDateTime(segment.depart_at)} - ${formatDateTime(segment.arrive_at)}`)}</span>
            </div>
            <div class="segment-meta">票价 ${escapeHtml(formatPrice(segment.price))}</div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderRecommendationSegments(plan) {
  return `
    <div class="recommendation-trains">
      ${plan.segments.map((segment) => `
        <div class="recommendation-train">
          <strong>${escapeHtml(`${segment.train_number} · ${segment.board_station} → ${segment.alight_station}`)}</strong>
          <span>${escapeHtml(`${formatDateTime(segment.depart_at)} - ${formatDateTime(segment.arrive_at)}`)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRecommendations(recommendations) {
  const recommendationEntries = Object.entries(recommendations || {}).filter(([, plan]) => Boolean(plan));
  if (!recommendationEntries.length) {
    return '';
  }

  return `
    <section>
      <div class="results-head">
        <div>
          <h2>三类推荐</h2>
          <p>从耗时、价格和卧铺体验三个维度分别给出优先方案。</p>
        </div>
      </div>
      <div class="recommendations-grid">
        ${recommendationEntries.map(([tag, plan]) => `
          <article class="recommendation-card">
            <span class="badge">${escapeHtml(recommendationLabels[tag] || tag)}</span>
            <h3>${escapeHtml(strategyLabels[plan.strategy] || plan.strategy)}</h3>
            <p>${escapeHtml(recommendationDescriptions[tag] || strategyDescriptions[plan.strategy] || '')}</p>
            <div class="recommendation-meta">
              <span>${escapeHtml(`${plan.total_travel_minutes} 分钟`)}</span>
              <span>${escapeHtml(formatPrice(plan.total_price))}</span>
            </div>
            <div class="recommendation-route">${escapeHtml(plan.segments.map((segment) => `${segment.board_station}→${segment.alight_station}`).join(' / '))}</div>
            ${renderRecommendationSegments(plan)}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderPlans(payload) {
  const plans = payload.plans || [];
  const recommendations = payload.recommendations || {};
  results.innerHTML = `
    ${renderRecommendations(recommendations)}
    <section>
      <div class="results-head">
        <div>
          <h2>完整候选方案</h2>
          <p>共 ${plans.length} 条候选，可继续对比购票复杂度与座席类型。</p>
        </div>
      </div>
      <div class="results-list">
        ${plans.map((plan) => renderPlanCard(plan)).join('')}
      </div>
    </section>
  `;
}

function createStationField(field) {
  const visibleInput = field.querySelector('[data-station-input]');
  const hiddenInput = field.querySelector('[data-station-value]');
  const dropdown = field.querySelector('[data-station-dropdown]');
  if (!visibleInput || !hiddenInput || !dropdown) {
    return null;
  }

  const state = {
    items: [],
    activeIndex: -1,
    requestId: 0,
    debounceTimer: null,
  };

  function closeDropdown() {
    dropdown.classList.remove('open');
    state.activeIndex = -1;
  }

  function openDropdown() {
    if (dropdown.childElementCount > 0) {
      dropdown.classList.add('open');
    }
  }

  function selectStation(station) {
    hiddenInput.value = station.name;
    visibleInput.value = station.name;
    visibleInput.setCustomValidity('');
    closeDropdown();
  }

  function renderOptions(items) {
    state.items = items;
    state.activeIndex = items.length ? 0 : -1;
    dropdown.innerHTML = items.map((station, index) => `
      <button type="button" class="station-option${index === state.activeIndex ? ' active' : ''}" data-station-index="${index}">
        <strong>${escapeHtml(station.name)}</strong>
        <span>${escapeHtml([station.pinyin, station.abbr, station.telecode].filter(Boolean).join(' · '))}</span>
      </button>
    `).join('');
    if (items.length) {
      openDropdown();
    } else {
      closeDropdown();
    }
  }

  function updateActiveIndex(nextIndex) {
    const options = Array.from(dropdown.querySelectorAll('.station-option'));
    if (!options.length) {
      state.activeIndex = -1;
      return;
    }
    state.activeIndex = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      option.classList.toggle('active', index === state.activeIndex);
    });
    options[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  async function loadStations(query) {
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    try {
      const response = await fetch(`/api/stations?q=${encodeURIComponent(query)}&limit=12`);
      const data = await response.json();
      if (!response.ok || requestId !== state.requestId) {
        return;
      }
      renderOptions(data.stations || []);
    } catch {
      if (requestId === state.requestId) {
        closeDropdown();
      }
    }
  }

  visibleInput.addEventListener('focus', () => {
    if (state.items.length) {
      openDropdown();
      return;
    }
    loadStations(visibleInput.value.trim());
  });

  visibleInput.addEventListener('input', () => {
    hiddenInput.value = '';
    const query = visibleInput.value.trim();
    visibleInput.setCustomValidity(query ? '请选择下拉列表中的有效站点' : '请选择有效的 12306 站点');
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      loadStations(query);
    }, 180);
  });

  visibleInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!hiddenInput.value) {
        visibleInput.setCustomValidity('请选择下拉列表中的有效站点');
      }
      closeDropdown();
    }, 120);
  });

  visibleInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!dropdown.classList.contains('open')) {
        openDropdown();
      }
      updateActiveIndex(state.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveIndex(state.activeIndex - 1);
    } else if (event.key === 'Enter' && dropdown.classList.contains('open') && state.activeIndex >= 0) {
      event.preventDefault();
      const station = state.items[state.activeIndex];
      if (station) {
        selectStation(station);
      }
    } else if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  dropdown.addEventListener('mousedown', (event) => {
    const option = event.target.closest('.station-option');
    if (!option) {
      return;
    }
    event.preventDefault();
    const station = state.items[Number(option.dataset.stationIndex)];
    if (station) {
      selectStation(station);
    }
  });

  return {
    visibleInput,
    hiddenInput,
  };
}

const stationControllers = stationFields.map(createStationField).filter(Boolean);

if (form && results) {
  const dateInput = form.querySelector('input[name="travel_date"]');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    for (const controller of stationControllers) {
      if (!controller.hiddenInput.value) {
        controller.visibleInput.setCustomValidity('请选择下拉列表中的有效站点');
        controller.visibleInput.reportValidity();
        return;
      }
      controller.visibleInput.setCustomValidity('');
    }

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
        throw new Error(data.detail || '查询失败，请稍后重试。');
      }

      if (!data.plans || data.plans.length === 0) {
        renderEmptyState('没有找到可购买方案，请尝试调整日期或重新选择站点。');
        return;
      }

      renderPlans(data);
    } catch (error) {
      if (error.name !== 'AbortError') {
        renderEmptyState(error.message || '查询失败，请稍后重试。');
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '查询最优方案';
      }
    }
  });
}
