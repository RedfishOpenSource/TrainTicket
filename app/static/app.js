const form = document.getElementById('search-form');
const results = document.getElementById('results');
const cityFields = Array.from(document.querySelectorAll('[data-city-field]'));
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

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getErrorMessage(response, payload) {
  if (typeof payload?.detail === 'string' && payload.detail.trim()) {
    return payload.detail;
  }
  if (response.status >= 500) {
    return '查询服务暂时不可用，请稍后重试。';
  }
  return '查询失败，请稍后重试。';
}

function buildErrorState(error, response, payload) {
  if (response?.status === 400) {
    return {
      kind: 'validation',
      badge: '输入有误',
      title: '请先确认有效站点后再查询',
      message: getErrorMessage(response, payload),
      hint: '请重新选择出发城市和到达城市，并在多站城市中确认具体车站。',
    };
  }
  if (response?.status === 502) {
    return {
      kind: 'upstream',
      badge: '12306 异常',
      title: '12306 当前未返回有效余票数据',
      message: getErrorMessage(response, payload),
      hint: '这类情况通常是上游接口临时异常，可稍后重试或更换出发时间。',
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: 'network',
      badge: '网络异常',
      title: '当前无法连接查询服务',
      message: '请检查网络连接或确认服务是否正常运行。',
      hint: '如果是本地调试环境，请先确认后端服务已启动。',
    };
  }
  return {
    kind: 'generic',
    badge: '查询失败',
    title: '当前查询暂时没有成功返回',
    message: error?.message || '查询失败，请稍后重试。',
    hint: '可以稍后重试，或重新确认查询日期与站点选择。',
  };
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

function renderErrorState(errorState) {
  results.innerHTML = `
    <article class="empty-card error-card ${escapeHtml(`error-${errorState.kind}`)}">
      <span class="badge error-badge">${escapeHtml(errorState.badge)}</span>
      <h3 class="error-title">${escapeHtml(errorState.title)}</h3>
      <p class="error-message">${escapeHtml(errorState.message)}</p>
      <p class="error-hint">${escapeHtml(errorState.hint)}</p>
    </article>
  `;
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

function createCitySelector(field) {
  const visibleInput = field.querySelector('[data-city-input]');
  const hiddenInput = field.querySelector('[data-station-value]');
  const dropdown = field.querySelector('[data-city-dropdown]');
  const selectedStationHint = field.querySelector('[data-selected-station]');
  if (!visibleInput || !hiddenInput || !dropdown || !selectedStationHint) {
    return null;
  }

  const state = {
    items: [],
    activeIndex: -1,
    expandedCityIndex: -1,
    expandedStationIndex: 0,
    requestId: 0,
    debounceTimer: null,
    fetchController: null,
    selectedCity: '',
  };

  function openDropdown() {
    if (dropdown.childElementCount > 0) {
      dropdown.classList.add('open');
    }
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
    state.activeIndex = -1;
    state.expandedCityIndex = -1;
    state.expandedStationIndex = 0;
  }

  function setSelectedStation(station, cityName) {
    hiddenInput.value = station.name;
    visibleInput.value = cityName;
    state.selectedCity = cityName;
    selectedStationHint.textContent = `已选车站：${station.name}`;
    visibleInput.setCustomValidity('');
    closeDropdown();
  }

  function clearSelectedStation() {
    hiddenInput.value = '';
    state.selectedCity = '';
    selectedStationHint.textContent = '';
  }

  function renderOptions(items) {
    state.items = items;
    state.activeIndex = items.length ? 0 : -1;
    if (!items.length) {
      dropdown.innerHTML = '<div class="station-empty">未找到匹配城市，请换个关键词试试</div>';
      openDropdown();
      return;
    }

    dropdown.innerHTML = items.map((city, index) => {
      const stations = city.stations || [];
      const isExpanded = index === state.expandedCityIndex;
      const cityMeta = city.display_label || `${stations.length} 个车站`;
      const subOptions = stations.length > 1 && isExpanded
        ? `<div class="station-suboptions">${stations.map((station, stationIndex) => `
            <button type="button" class="station-suboption${stationIndex === state.expandedStationIndex ? ' active' : ''}" data-city-index="${index}" data-station-index="${stationIndex}">${escapeHtml(station.name)}</button>
          `).join('')}</div>`
        : '';
      return `
        <button type="button" class="station-option${index === state.activeIndex ? ' active' : ''}" data-city-index="${index}">
          <strong>${escapeHtml(city.city_name)}</strong>
          <span>${escapeHtml(cityMeta)}</span>
        </button>
        ${subOptions}
      `;
    }).join('');
    openDropdown();
  }

  function updateActiveIndex(nextIndex) {
    const options = Array.from(dropdown.querySelectorAll('.station-option'));
    if (!options.length) {
      state.activeIndex = -1;
      return;
    }
    state.activeIndex = (nextIndex + options.length) % options.length;
    state.expandedCityIndex = -1;
    options.forEach((option, index) => {
      option.classList.toggle('active', index === state.activeIndex);
    });
    options[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function expandCity(index) {
    state.expandedCityIndex = index;
    state.expandedStationIndex = 0;
    renderOptions(state.items);
  }

  function chooseActiveItem() {
    const city = state.items[state.activeIndex];
    if (!city) {
      return;
    }
    if ((city.stations || []).length <= 1) {
      const [station] = city.stations || [];
      if (station) {
        setSelectedStation(station, city.city_name);
      }
      return;
    }
    expandCity(state.activeIndex);
    visibleInput.setCustomValidity('请选择具体车站');
  }

  async function loadCities(query) {
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    state.fetchController?.abort();
    state.fetchController = new AbortController();
    try {
      const response = await fetch(`/api/cities?q=${encodeURIComponent(query)}&limit=12`, {
        signal: state.fetchController.signal,
      });
      const data = await response.json();
      if (!response.ok || requestId !== state.requestId) {
        return;
      }
      renderOptions(data.cities || []);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      if (requestId === state.requestId) {
        dropdown.innerHTML = '<div class="station-empty">城市候选加载失败，请重试</div>';
        openDropdown();
      }
    }
  }

  visibleInput.addEventListener('focus', () => {
    if (state.items.length) {
      openDropdown();
      return;
    }
    loadCities(visibleInput.value.trim());
  });

  visibleInput.addEventListener('input', () => {
    const query = visibleInput.value.trim();
    if (query !== state.selectedCity) {
      clearSelectedStation();
    }
    visibleInput.setCustomValidity(query ? '请选择城市，并在需要时确认具体车站' : '请选择有效城市');
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      loadCities(query);
    }, 180);
  });

  visibleInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!hiddenInput.value) {
        visibleInput.setCustomValidity(visibleInput.value.trim() ? '请选择具体车站' : '请选择有效城市');
      }
      closeDropdown();
    }, 120);
  });

  visibleInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (state.expandedCityIndex >= 0) {
        const stations = state.items[state.expandedCityIndex]?.stations || [];
        state.expandedStationIndex = (state.expandedStationIndex + 1 + stations.length) % stations.length;
        renderOptions(state.items);
        return;
      }
      if (!dropdown.classList.contains('open')) {
        openDropdown();
      }
      updateActiveIndex(state.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (state.expandedCityIndex >= 0) {
        const stations = state.items[state.expandedCityIndex]?.stations || [];
        state.expandedStationIndex = (state.expandedStationIndex - 1 + stations.length) % stations.length;
        renderOptions(state.items);
        return;
      }
      updateActiveIndex(state.activeIndex - 1);
    } else if (event.key === 'Enter' && dropdown.classList.contains('open')) {
      event.preventDefault();
      if (state.expandedCityIndex >= 0) {
        const city = state.items[state.expandedCityIndex];
        const station = city?.stations?.[state.expandedStationIndex];
        if (station) {
          setSelectedStation(station, city.city_name);
        }
        return;
      }
      chooseActiveItem();
    } else if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  dropdown.addEventListener('mousedown', (event) => {
    const subOption = event.target.closest('.station-suboption');
    if (subOption) {
      event.preventDefault();
      const city = state.items[Number(subOption.dataset.cityIndex)];
      const station = city?.stations?.[Number(subOption.dataset.stationIndex)];
      if (city && station) {
        setSelectedStation(station, city.city_name);
      }
      return;
    }

    const cityOption = event.target.closest('.station-option');
    if (!cityOption) {
      return;
    }
    event.preventDefault();
    state.activeIndex = Number(cityOption.dataset.cityIndex);
    chooseActiveItem();
  });

  return {
    visibleInput,
    hiddenInput,
  };
}

const stationControllers = cityFields.map(createCitySelector).filter(Boolean);

if (form && results) {
  const dateInput = form.querySelector('input[name="travel_date"]');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    for (const controller of stationControllers) {
      if (!controller.hiddenInput.value) {
        controller.visibleInput.setCustomValidity(controller.visibleInput.value.trim() ? '请选择具体车站' : '请选择有效城市');
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
      const data = await readJsonSafely(response);

      if (!response.ok) {
        const error = new Error(getErrorMessage(response, data));
        error.response = response;
        error.payload = data;
        throw error;
      }

      if (!data.plans || data.plans.length === 0) {
        renderEmptyState('没有找到可购买方案，请尝试调整日期或重新选择站点。');
        return;
      }

      renderPlans(data);
    } catch (error) {
      if (error.name !== 'AbortError') {
        renderErrorState(buildErrorState(error, error.response, error.payload));
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '查询最优方案';
      }
    }
  });
}
