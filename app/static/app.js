const form = document.getElementById('search-form');
const results = document.getElementById('results');
const cityFields = Array.from(document.querySelectorAll('[data-city-field]'));
const swapButton = document.querySelector('[data-swap-stations]');
const stationSheet = document.querySelector('[data-station-sheet]');
const sheetSearchWrapper = stationSheet?.querySelector('.sheet-search');
const sheetSearchInput = stationSheet?.querySelector('[data-sheet-search]');
const sheetList = stationSheet?.querySelector('[data-sheet-list]');
const sheetCurrent = stationSheet?.querySelector('[data-sheet-current]');
const sheetCloseButton = stationSheet?.querySelector('[data-sheet-close]');
const sheetBackButton = stationSheet?.querySelector('[data-sheet-back]');
const sheetTitle = stationSheet?.querySelector('[data-sheet-title]');
const sheetSubtitle = stationSheet?.querySelector('[data-sheet-subtitle]');
const recommendationLabels = {
  shortest_duration: '最短耗时',
  cheapest_price: '最低票价',
  sleeper_priority: '卧铺优先',
};
const recommendationOrder = ['sleeper_priority', 'cheapest_price', 'shortest_duration'];
const cityValidationMessage = '请选择有效城市';
const stationValidationMessage = '请选择具体车站';
const sheetClosedState = {
  mode: 'closed',
  items: [],
  selectedCity: null,
  isLoading: false,
  errorMessage: '',
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
const sheetState = {
  mode: 'closed',
  items: [],
  selectedCity: null,
  requestId: 0,
  debounceTimer: null,
  fetchController: null,
  isLoading: false,
  errorMessage: '',
  lastQuery: '',
};
let currentController = null;
let activeSheetController = null;
let latestSearchPayload = null;
let latestRenderedPayload = null;
let autoRetryTimer = null;
const autoRetryState = {
  isRunning: false,
  attempts: 0,
};
const AUTO_RETRY_DELAY_MS = 1200;

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
      <div class="card-header">
        <span class="badge">正在分析</span>
        <h3 class="result-title">正在计算推荐购票路径...</h3>
        <p class="result-subtitle">系统正在比较直达、买长坐短、拆票和换乘方案，并同步生成多维推荐。</p>
      </div>
      <div class="metric-row">
        <div class="metric"><span>预计耗时</span><strong>--</strong></div>
        <div class="metric"><span>预计票价</span><strong>--</strong></div>
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
  const segmentCountLabel = plan.segments.length > 1 ? `${plan.segments.length} 段行程` : '单段直达';
  const seatTypes = Array.from(new Set(plan.segments.map((segment) => segment.seat_type))).join(' / ');
  return `
    <article class="result-card">
      <div class="card-header">
        <span class="badge">${escapeHtml(strategyLabels[plan.strategy] || plan.strategy)}</span>
        <h3 class="result-title">${escapeHtml(title || strategyLabels[plan.strategy] || plan.strategy)}</h3>
        <p class="result-subtitle">${escapeHtml(subtitle || strategyDescriptions[plan.strategy] || '这是当前排序最优的购票策略。')}</p>
      </div>
      <div class="metric-row">
        <div class="metric">
          <span>总耗时</span>
          <strong>${escapeHtml(`${plan.total_travel_minutes} 分钟`)}</strong>
        </div>
        <div class="metric">
          <span>总票价</span>
          <strong>${escapeHtml(formatPrice(plan.total_price))}</strong>
        </div>
      </div>
      <div class="summary-strip">
        <span class="summary-pill">${escapeHtml(segmentCountLabel)}</span>
        <span class="summary-pill">${escapeHtml(seatTypes || '座席待定')}</span>
      </div>
      <div class="segments">
        ${plan.segments.map((segment, index) => `
          <div class="segment">
            <div class="segment-index">${index + 1}</div>
            <div class="segment-train">
              <strong>${escapeHtml(`${segment.train_number} · ${segment.board_station} → ${segment.alight_station}`)}</strong>
              <span>${escapeHtml(`${segment.seat_type} ｜ ${formatDateTime(segment.depart_at)} - ${formatDateTime(segment.arrive_at)}`)}</span>
            </div>
            <div class="segment-meta">
              <span>${escapeHtml(`票价 ${formatPrice(segment.price)}`)}</span>
            </div>
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

function failedCandidateSortKey(candidate) {
  return `${candidate.departure_station}-${candidate.arrival_station}-${candidate.train_code}`;
}

function renderFailedCandidate(candidate, index) {
  return `
    <article class="result-card failed-candidate-card">
      <div class="card-header">
        <span class="badge error-badge">查询异常</span>
        <h3 class="result-title">${escapeHtml(`${candidate.departure_station} → ${candidate.arrival_station}`)}</h3>
        <p class="result-subtitle">${escapeHtml(candidate.reason || '该候选方案补票查询失败，可单独重试。')}</p>
      </div>
      <div class="summary-strip">
        <span class="summary-pill">${escapeHtml(candidate.train_code || '未知车次')}</span>
        <span class="summary-pill">异常候选 ${index + 1}</span>
      </div>
      <button
        type="button"
        class="secondary-button retry-plan-button"
        data-retry-train-code="${escapeHtml(candidate.train_code || '')}"
        data-retry-travel-date="${escapeHtml(candidate.travel_date || '')}"
        data-retry-departure="${escapeHtml(candidate.departure_station || '')}"
        data-retry-arrival="${escapeHtml(candidate.arrival_station || '')}"
      >单独重查这个方案</button>
    </article>
  `;
}

function renderRecommendationCandidate(candidate, index) {
  if (candidate.reason) {
    return renderFailedCandidate(candidate, index);
  }
  return renderPlanCard(candidate);
}

function renderRecommendationGroup(tag, plan, candidates, failedCandidates) {
  const expandedCandidates = [...failedCandidates, ...candidates];
  const candidateCount = expandedCandidates.length;
  const recommendationTitle = strategyLabels[plan?.strategy] || recommendationLabels[tag] || tag;
  const recommendationDescription = recommendationDescriptions[tag] || strategyDescriptions[plan?.strategy] || '';
  const routeSummary = plan
    ? plan.segments.map((segment) => `${segment.board_station}→${segment.alight_station}`).join(' / ')
    : '';

  return `
    <article class="recommendation-card expandable" data-recommendation-tag="${escapeHtml(tag)}">
      <button type="button" class="recommendation-toggle" data-recommendation-toggle="${escapeHtml(tag)}" aria-expanded="false">
        <span class="badge">${escapeHtml(recommendationLabels[tag] || tag)}</span>
        <h3>${escapeHtml(recommendationTitle)}</h3>
        <p>${escapeHtml(recommendationDescription)}</p>
        ${plan ? `
          <div class="recommendation-meta">
            <span>${escapeHtml(`${plan.total_travel_minutes} 分钟`)}</span>
            <span>${escapeHtml(formatPrice(plan.total_price))}</span>
          </div>
          <div class="recommendation-route">${escapeHtml(routeSummary)}</div>
          ${renderRecommendationSegments(plan)}
        ` : '<div class="recommendation-route">当前没有成功返回推荐方案</div>'}
        <div class="recommendation-expand-hint">点击展开 ${candidateCount} 条候选方案</div>
      </button>
      <div class="recommendation-candidates" data-recommendation-panel="${escapeHtml(tag)}" hidden>
        ${expandedCandidates.length ? expandedCandidates.map(renderRecommendationCandidate).join('') : '<article class="empty-card">当前维度没有可展示候选方案。</article>'}
      </div>
    </article>
  `;
}

function renderRecommendations(recommendations, recommendationCandidates, failedCandidates) {
  const orderedTags = recommendationOrder.filter((tag) => recommendations?.[tag] || recommendationCandidates?.[tag]?.length || failedCandidates?.[tag]?.length);
  if (!orderedTags.length) {
    return '';
  }

  return `
    <section class="section-stack">
      <div class="results-head">
        <div>
          <h2>三类推荐</h2>
          <p>按卧铺优先、最低票价、最短耗时顺序展示，点开后可看当前维度全部候选。</p>
        </div>
      </div>
      <div class="recommendations-grid">
        ${orderedTags.map((tag) => renderRecommendationGroup(tag, recommendations?.[tag], recommendationCandidates?.[tag] || [], failedCandidates?.[tag] || [])).join('')}
      </div>
    </section>
  `;
}

function groupFailedCandidatesByRecommendation(failedCandidates) {
  const grouped = {
    sleeper_priority: [],
    cheapest_price: [],
    shortest_duration: [],
  };
  const sortedFailed = [...(failedCandidates || [])].sort((left, right) => failedCandidateSortKey(left).localeCompare(failedCandidateSortKey(right), 'zh-CN'));
  for (const tag of recommendationOrder) {
    grouped[tag] = sortedFailed;
  }
  return grouped;
}

function mergeUniqueFailedCandidates(candidates) {
  const deduplicated = new Map();
  (candidates || []).forEach((candidate) => {
    deduplicated.set(failedCandidateSortKey(candidate), candidate);
  });
  return [...deduplicated.values()].sort((left, right) => failedCandidateSortKey(left).localeCompare(failedCandidateSortKey(right), 'zh-CN'));
}

function mergeUniquePlans(plans) {
  const deduplicated = new Map();
  (plans || []).forEach((plan) => {
    const key = JSON.stringify({
      strategy: plan.strategy,
      total_price: Number(plan.total_price || 0),
      total_travel_minutes: plan.total_travel_minutes,
      segments: (plan.segments || []).map((segment) => ({
        train_number: segment.train_number,
        board_station: segment.board_station,
        alight_station: segment.alight_station,
        seat_type: segment.seat_type,
        price: Number(segment.price || 0),
      })),
    });
    deduplicated.set(key, plan);
  });
  return [...deduplicated.values()].sort((left, right) => {
    if (left.total_travel_minutes !== right.total_travel_minutes) {
      return left.total_travel_minutes - right.total_travel_minutes;
    }
    if (Number(left.total_price || 0) !== Number(right.total_price || 0)) {
      return Number(left.total_price || 0) - Number(right.total_price || 0);
    }
    return (left.segments?.length || 0) - (right.segments?.length || 0);
  });
}

function hasFullSleeperPlan(plan) {
  return Array.isArray(plan?.segments) && plan.segments.length > 0 && plan.segments.every((segment) => String(segment.seat_type || '').includes('卧'));
}

function chooseRecommendationPlans(plans) {
  const uniquePlans = mergeUniquePlans(plans);
  const cheapestCandidates = [...uniquePlans].sort((left, right) => {
    if (Number(left.total_price || 0) !== Number(right.total_price || 0)) {
      return Number(left.total_price || 0) - Number(right.total_price || 0);
    }
    if (left.total_travel_minutes !== right.total_travel_minutes) {
      return left.total_travel_minutes - right.total_travel_minutes;
    }
    return (left.segments?.length || 0) - (right.segments?.length || 0);
  });
  const shortestCandidates = [...uniquePlans].sort((left, right) => {
    if (left.total_travel_minutes !== right.total_travel_minutes) {
      return left.total_travel_minutes - right.total_travel_minutes;
    }
    if (Number(left.total_price || 0) !== Number(right.total_price || 0)) {
      return Number(left.total_price || 0) - Number(right.total_price || 0);
    }
    return (left.segments?.length || 0) - (right.segments?.length || 0);
  });
  const sleeperCandidates = cheapestCandidates.filter(hasFullSleeperPlan);
  return {
    recommendations: {
      ...(sleeperCandidates[0] ? { sleeper_priority: sleeperCandidates[0] } : {}),
      ...(cheapestCandidates[0] ? { cheapest_price: cheapestCandidates[0] } : {}),
      ...(shortestCandidates[0] ? { shortest_duration: shortestCandidates[0] } : {}),
    },
    recommendationCandidates: {
      sleeper_priority: sleeperCandidates,
      cheapest_price: cheapestCandidates,
      shortest_duration: shortestCandidates,
    },
  };
}

function normalizePayload(payload) {
  const plans = mergeUniquePlans(payload?.plans || []);
  const failedCandidates = mergeUniqueFailedCandidates(payload?.failed_candidates || []);
  const hasRecommendationData = recommendationOrder.some((tag) => payload?.recommendations?.[tag] || payload?.recommendation_candidates?.[tag]?.length);
  const fallbackRecommendations = chooseRecommendationPlans(plans);
  return {
    plans,
    failed_candidates: failedCandidates,
    recommendations: hasRecommendationData ? (payload?.recommendations || {}) : fallbackRecommendations.recommendations,
    recommendation_candidates: hasRecommendationData ? (payload?.recommendation_candidates || {}) : fallbackRecommendations.recommendationCandidates,
  };
}

function renderPlans(payload) {
  const normalizedPayload = normalizePayload(payload);
  latestRenderedPayload = normalizedPayload;
  const plans = normalizedPayload.plans || [];
  const recommendations = normalizedPayload.recommendations || {};
  const recommendationCandidates = normalizedPayload.recommendation_candidates || {};
  const failedCandidates = groupFailedCandidatesByRecommendation(normalizedPayload.failed_candidates || []);
  results.innerHTML = `
    ${renderRecommendations(recommendations, recommendationCandidates, failedCandidates)}
    <section class="section-stack">
      <div class="results-head">
        <div>
          <h2>完整候选方案</h2>
          <p>共 ${plans.length} 条成功候选，可继续对比购票复杂度与座席类型。</p>
        </div>
      </div>
      <div class="results-list">
        ${(normalizedPayload.failed_candidates || []).map((candidate, index) => renderFailedCandidate(candidate, index)).join('')}
        ${plans.map((plan) => renderPlanCard(plan)).join('')}
      </div>
    </section>
  `;
}

function scrollResultsIntoView() {
  results?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindRecommendationToggles() {
  results.querySelectorAll('[data-recommendation-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.recommendationToggle;
      const panel = results.querySelector(`[data-recommendation-panel="${tag}"]`);
      if (!panel) {
        return;
      }
      const nextExpanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      panel.hidden = !nextExpanded;
    });
  });
}

function buildRetryCandidatePayload(candidate) {
  return {
    travel_date: candidate.travel_date,
    departure_station: candidate.departure_station,
    arrival_station: candidate.arrival_station,
    train_code: candidate.train_code,
  };
}

async function requestRetryCandidate(candidate) {
  const response = await fetch('/api/retry-candidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRetryCandidatePayload(candidate)),
  });
  const data = await readJsonSafely(response);
  if (!response.ok) {
    const error = new Error(getErrorMessage(response, data));
    error.response = response;
    error.payload = data;
    throw error;
  }
  return data;
}

function scheduleAutoRetry() {
  window.clearTimeout(autoRetryTimer);
  const failedCandidates = latestRenderedPayload?.failed_candidates || [];
  if (!failedCandidates.length || autoRetryState.isRunning || !latestSearchPayload) {
    return;
  }
  autoRetryTimer = window.setTimeout(() => {
    autoRetryFailedCandidates();
  }, AUTO_RETRY_DELAY_MS);
}

async function autoRetryFailedCandidates() {
  const failedCandidates = latestRenderedPayload?.failed_candidates || [];
  if (!failedCandidates.length || autoRetryState.isRunning || !latestSearchPayload) {
    return;
  }

  autoRetryState.isRunning = true;
  autoRetryState.attempts += 1;
  try {
    const response = await fetch('/api/retry-failed-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        travel_date: latestSearchPayload.travel_date,
        departure_station: latestSearchPayload.departure_station,
        arrival_station: latestSearchPayload.arrival_station,
        candidates: failedCandidates.map(buildRetryCandidatePayload),
      }),
    });
    const data = await readJsonSafely(response);
    if (!response.ok) {
      const error = new Error(getErrorMessage(response, data));
      error.response = response;
      error.payload = data;
      throw error;
    }

    renderPlans(data);
    bindResultsActions();
  } finally {
    autoRetryState.isRunning = false;
    if (latestRenderedPayload?.failed_candidates?.length) {
      scheduleAutoRetry();
    }
  }
}

async function rerunLatestSearch() {
  if (!latestSearchPayload) {
    return null;
  }
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(latestSearchPayload),
  });
  const data = await readJsonSafely(response);
  if (!response.ok) {
    const error = new Error(getErrorMessage(response, data));
    error.response = response;
    error.payload = data;
    throw error;
  }
  return data;
}

async function retryFailedCandidate(button) {
  const trainCode = button.dataset.retryTrainCode;
  const departureStation = button.dataset.retryDeparture;
  const arrivalStation = button.dataset.retryArrival;
  const travelDate = button.dataset.retryTravelDate;
  if (!trainCode || !departureStation || !arrivalStation || !travelDate || !latestRenderedPayload) {
    return;
  }

  const retryCandidate = {
    travel_date: travelDate,
    departure_station: departureStation,
    arrival_station: arrivalStation,
    train_code: trainCode,
  };

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '正在重查...';
  try {
    await requestRetryCandidate(retryCandidate);
    const refreshedData = await rerunLatestSearch();
    if (!refreshedData) {
      return;
    }
    autoRetryState.attempts = 0;
    autoRetryState.isRunning = false;
    window.clearTimeout(autoRetryTimer);
    renderPlans(refreshedData);
    bindResultsActions();
    scheduleAutoRetry();
  } catch (error) {
    renderErrorState(buildErrorState(error, error.response, error.payload));
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function bindRetryButtons() {
  results.querySelectorAll('[data-retry-train-code]').forEach((button) => {
    button.addEventListener('click', () => {
      retryFailedCandidate(button);
    });
  });
}

function bindResultsActions() {
  bindRecommendationToggles();
  bindRetryButtons();
}

function abortSheetRequest() {
  window.clearTimeout(sheetState.debounceTimer);
  sheetState.fetchController?.abort();
  sheetState.fetchController = null;
}

function resetSheetState(overrides = {}) {
  Object.assign(sheetState, sheetClosedState, overrides);
}

function getControllerLabel(controller) {
  return controller?.field.dataset.fieldLabel || '城市';
}

function getControllerSheetTitle(controller) {
  return controller?.field.dataset.sheetTitle || `选择${getControllerLabel(controller)}`;
}

function applySelection(controller, selection) {
  const cityName = selection?.cityName || '';
  const stationName = selection?.stationName || '';
  controller.hiddenInput.value = stationName;
  controller.visibleInput.value = cityName;
  controller.state.selectedCity = cityName;
  controller.selectedStationHint.textContent = stationName ? `已选车站：${stationName}` : '';
  controller.visibleInput.setCustomValidity(stationName ? '' : cityValidationMessage);
}

function renderSheetList(message) {
  if (!sheetList) {
    return;
  }
  if (message) {
    sheetList.innerHTML = `<div class="sheet-empty">${escapeHtml(message)}</div>`;
    return;
  }

  if (sheetState.mode === 'station-list' && sheetState.selectedCity) {
    const stations = sheetState.selectedCity.stations || [];
    if (!stations.length) {
      sheetList.innerHTML = '<div class="sheet-empty">当前城市下没有可选车站</div>';
      return;
    }
    sheetList.innerHTML = stations.map((station, index) => `
      <button type="button" class="sheet-station" data-sheet-station-index="${index}">
        <strong>${escapeHtml(station.name)}</strong>
        <span>${escapeHtml(station.telecode ? `12306 车站编码：${station.telecode}` : '点击后将直接带回表单')}</span>
      </button>
    `).join('');
    return;
  }

  if (sheetState.isLoading) {
    sheetList.innerHTML = '<div class="sheet-empty">正在加载城市候选...</div>';
    return;
  }
  if (sheetState.errorMessage) {
    sheetList.innerHTML = `<div class="sheet-empty">${escapeHtml(sheetState.errorMessage)}</div>`;
    return;
  }
  if (!sheetState.items.length) {
    sheetList.innerHTML = '<div class="sheet-empty">未找到匹配城市，请换个关键词试试</div>';
    return;
  }

  sheetList.innerHTML = sheetState.items.map((city, index) => {
    const stations = city.stations || [];
    const cityMeta = city.display_label || `${stations.length} 个车站`;
    const selectionHint = stations.length > 1 ? '点击后继续选择具体车站' : '点击后将直接带回表单';
    return `
      <button type="button" class="sheet-option" data-sheet-city-index="${index}">
        <strong>${escapeHtml(city.city_name)}</strong>
        <span>${escapeHtml(`${cityMeta} · ${selectionHint}`)}</span>
      </button>
    `;
  }).join('');
}

function renderSheet() {
  if (!activeSheetController || !stationSheet || !sheetTitle || !sheetSubtitle || !sheetBackButton || !sheetCurrent || !sheetSearchWrapper) {
    return;
  }

  if (sheetState.mode === 'station-list' && sheetState.selectedCity) {
    const stations = sheetState.selectedCity.stations || [];
    sheetTitle.textContent = `选择${sheetState.selectedCity.city_name}车站`;
    sheetSubtitle.textContent = '请再点一次具体车站，确认最终使用的 12306 站点。';
    sheetBackButton.hidden = false;
    sheetSearchWrapper.hidden = true;
    sheetCurrent.hidden = false;
    sheetCurrent.textContent = `${sheetState.selectedCity.city_name} 下共 ${stations.length} 个车站，请继续选择。`;
  } else {
    sheetTitle.textContent = getControllerSheetTitle(activeSheetController);
    sheetSubtitle.textContent = `先搜索${getControllerLabel(activeSheetController)}，再确认具体车站。`;
    sheetBackButton.hidden = true;
    sheetSearchWrapper.hidden = false;
    sheetCurrent.hidden = true;
  }

  renderSheetList();
}

async function loadCities(query) {
  if (!activeSheetController || !sheetList) {
    return;
  }

  abortSheetRequest();
  const requestId = sheetState.requestId + 1;
  sheetState.requestId = requestId;
  sheetState.fetchController = new AbortController();
  sheetState.mode = 'city-list';
  sheetState.selectedCity = null;
  sheetState.lastQuery = query;
  sheetState.isLoading = true;
  sheetState.errorMessage = '';
  renderSheet();

  try {
    const response = await fetch(`/api/cities?q=${encodeURIComponent(query)}&limit=12`, {
      signal: sheetState.fetchController.signal,
    });
    const data = await readJsonSafely(response);
    if (!activeSheetController || requestId !== sheetState.requestId) {
      return;
    }
    if (!response.ok) {
      throw new Error(getErrorMessage(response, data));
    }
    sheetState.items = data.cities || [];
    sheetState.isLoading = false;
    sheetState.errorMessage = '';
    renderSheet();
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    if (!activeSheetController || requestId !== sheetState.requestId) {
      return;
    }
    sheetState.items = [];
    sheetState.isLoading = false;
    sheetState.errorMessage = '城市候选加载失败，请重试';
    renderSheet();
  }
}

function openStationSheet(controller) {
  if (!stationSheet || !sheetSearchInput) {
    return;
  }

  activeSheetController = controller;
  controller.visibleInput.setCustomValidity('');
  resetSheetState({ mode: 'city-list' });
  sheetState.lastQuery = controller.state.selectedCity || controller.visibleInput.value.trim();
  sheetSearchInput.value = sheetState.lastQuery;
  stationSheet.hidden = false;
  document.body.classList.add('sheet-open');
  renderSheetList('正在准备城市候选...');
  renderSheet();
  loadCities(sheetState.lastQuery);
  window.setTimeout(() => {
    sheetSearchInput.focus();
  }, 20);
}

function closeStationSheet(options = {}) {
  const { restoreFocus = false } = options;
  const controller = activeSheetController;
  abortSheetRequest();
  activeSheetController = null;
  resetSheetState();
  if (stationSheet) {
    stationSheet.hidden = true;
  }
  document.body.classList.remove('sheet-open');
  if (sheetList) {
    sheetList.innerHTML = '';
  }
  if (controller && !controller.hiddenInput.value) {
    controller.visibleInput.setCustomValidity(cityValidationMessage);
  }
  if (restoreFocus && controller) {
    controller.visibleInput.focus({ preventScroll: true });
  }
}

function selectCity(city) {
  if (!activeSheetController) {
    return;
  }
  const stations = city.stations || [];
  if (stations.length <= 1) {
    const [station] = stations;
    if (station) {
      applySelection(activeSheetController, {
        cityName: city.city_name,
        stationName: station.name,
      });
      closeStationSheet();
    }
    return;
  }
  sheetState.mode = 'station-list';
  sheetState.selectedCity = city;
  renderSheet();
}

function selectStation(station) {
  if (!activeSheetController || !sheetState.selectedCity) {
    return;
  }
  applySelection(activeSheetController, {
    cityName: sheetState.selectedCity.city_name,
    stationName: station.name,
  });
  closeStationSheet();
}

function createCitySelector(field) {
  const visibleInput = field.querySelector('[data-city-input]');
  const hiddenInput = field.querySelector('[data-station-value]');
  const selectedStationHint = field.querySelector('[data-selected-station]');
  if (!visibleInput || !hiddenInput || !selectedStationHint) {
    return null;
  }

  const controller = {
    field,
    visibleInput,
    hiddenInput,
    selectedStationHint,
    state: {
      selectedCity: visibleInput.value.trim(),
    },
    open() {
      openStationSheet(controller);
    },
  };

  const openFromInteraction = (event) => {
    if (event.target === hiddenInput) {
      return;
    }
    controller.open();
  };

  field.addEventListener('click', openFromInteraction);

  visibleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      controller.open();
    }
  });

  return controller;
}

const stationControllers = cityFields.map(createCitySelector).filter(Boolean);

if (sheetSearchInput) {
  sheetSearchInput.addEventListener('input', () => {
    if (!activeSheetController || sheetState.mode !== 'city-list') {
      return;
    }
    const query = sheetSearchInput.value.trim();
    window.clearTimeout(sheetState.debounceTimer);
    sheetState.debounceTimer = window.setTimeout(() => {
      loadCities(query);
    }, 180);
  });

  sheetSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeStationSheet({ restoreFocus: true });
    }
  });
}

sheetCloseButton?.addEventListener('click', () => {
  closeStationSheet({ restoreFocus: true });
});

sheetBackButton?.addEventListener('click', () => {
  sheetState.mode = 'city-list';
  sheetState.selectedCity = null;
  renderSheet();
  sheetSearchInput?.focus();
});

stationSheet?.addEventListener('click', (event) => {
  if (event.target === stationSheet) {
    closeStationSheet({ restoreFocus: true });
    return;
  }

  const stationButton = event.target.closest('[data-sheet-station-index]');
  if (stationButton && sheetState.selectedCity) {
    const station = sheetState.selectedCity.stations?.[Number(stationButton.dataset.sheetStationIndex)];
    if (station) {
      selectStation(station);
    }
    return;
  }

  const cityButton = event.target.closest('[data-sheet-city-index]');
  if (!cityButton) {
    return;
  }
  const city = sheetState.items[Number(cityButton.dataset.sheetCityIndex)];
  if (city) {
    selectCity(city);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeSheetController) {
    closeStationSheet({ restoreFocus: true });
  }
});

function swapSelections() {
  if (stationControllers.length < 2) {
    return;
  }
  const [departureController, arrivalController] = stationControllers;
  const departureSelection = {
    cityName: departureController.visibleInput.value,
    stationName: departureController.hiddenInput.value,
  };
  const arrivalSelection = {
    cityName: arrivalController.visibleInput.value,
    stationName: arrivalController.hiddenInput.value,
  };
  applySelection(departureController, arrivalSelection);
  applySelection(arrivalController, departureSelection);
}

swapButton?.addEventListener('click', () => {
  swapSelections();
});

if (form && results) {
  const dateInput = form.querySelector('input[name="travel_date"]');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    for (const controller of stationControllers) {
      if (!controller.hiddenInput.value) {
        controller.visibleInput.setCustomValidity(controller.visibleInput.value.trim() ? stationValidationMessage : cityValidationMessage);
        controller.visibleInput.reportValidity();
        controller.open();
        return;
      }
      controller.visibleInput.setCustomValidity('');
    }

    currentController?.abort();
    currentController = new AbortController();
    const payload = Object.fromEntries(new FormData(form).entries());
    latestSearchPayload = payload;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '正在计算...';
    }
    renderLoadingState();
    scrollResultsIntoView();

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

      const hasPlans = Array.isArray(data.plans) && data.plans.length > 0;
      const hasFailedCandidates = Array.isArray(data.failed_candidates) && data.failed_candidates.length > 0;
      if (!hasPlans && !hasFailedCandidates) {
        renderEmptyState('没有找到可购买方案，请尝试调整日期或重新选择站点。');
        return;
      }

      autoRetryState.attempts = 0;
      autoRetryState.isRunning = false;
      window.clearTimeout(autoRetryTimer);
      renderPlans(data);
      bindResultsActions();
      scheduleAutoRetry();
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
