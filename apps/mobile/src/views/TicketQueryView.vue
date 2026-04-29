<template>
  <main class="page-shell">
    <section class="page-container">
      <el-card shadow="hover" class="query-card query-card--compact">
        <div class="query-topbar query-topbar--compact">
          <el-button link type="primary" class="rules-entry" @click="$emit('showRules')">规则说明</el-button>
        </div>

        <div class="city-picker-row city-picker-row--snapshot">
          <button type="button" class="city-picker-trigger city-picker-trigger--left" @click="$emit('selectDeparture')">
            {{ store.input.departureCity || '出发城市' }}
          </button>

          <div class="city-swap-row city-swap-row--snapshot">
            <el-button circle class="swap-icon-button" :disabled="store.loading || stationsLoading" @click="store.swapCities()">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="swap-icon" fill="none">
                <path
                  d="M8 7C8 5.89543 8.89543 5 10 5H14C15.1046 5 16 5.89543 16 7V8.2C18.3282 9.02656 20 11.2489 20 13.8667C20 17.1871 17.3137 19.8667 14 19.8667C11.3815 19.8667 9.15932 18.1949 8.33276 15.8667H10.4612C11.1598 16.844 12.2986 17.4667 13.5833 17.4667C15.7064 17.4667 17.4275 15.7455 17.4275 13.6225C17.4275 11.4995 15.7064 9.77833 13.5833 9.77833C12.5326 9.77833 11.5804 10.2 10.8821 10.8821L12.4 12.4H7V7L8.86193 8.86193C9.63678 8.10448 10.5809 7.55843 11.6167 7.26667V7C11.6167 6.66863 11.8853 6.4 12.2167 6.4H13.7833C14.1147 6.4 14.3833 6.66863 14.3833 7V7.10451C12.2721 7.0054 10.2522 7.55106 8.5 8.66667V7Z"
                  fill="currentColor"
                />
              </svg>
            </el-button>
          </div>

          <button type="button" class="city-picker-trigger city-picker-trigger--right" @click="$emit('selectArrival')">
            {{ store.input.arrivalCity || '到达城市' }}
          </button>
        </div>

        <div class="date-row date-row--snapshot">
          <el-date-picker
            v-model="travelDateValue"
            type="date"
            placeholder="选择日期"
            format="M月D日"
            value-format="YYYY-MM-DD"
            :disabled-date="isPastDate"
            class="field-control date-picker-compact date-picker-compact--snapshot"
          />
        </div>

        <div class="action-row action-row--snapshot">
          <el-button type="primary" :loading="store.loading" :disabled="stationsLoading || !!stationsError" class="action-button action-button--primary action-button--snapshot" @click="store.submitQuery()">
            {{ store.loading ? '查询中...' : '查询车票' }}
          </el-button>
        </div>

        <el-alert
          v-if="stationsError"
          class="state-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="stationsError"
        />
        <el-alert
          v-else-if="store.errorMessage"
          class="state-alert"
          type="error"
          :closable="false"
          show-icon
          :title="store.errorMessage"
        />
      </el-card>

      <el-card v-if="store.result?.bestOption" shadow="hover" class="result-card">
        <template #header>
          <div class="section-header result-header">
            <div>
              <h2>最优推荐</h2>
              <p>按当前规则排序后的首选方案</p>
            </div>
            <el-tag :type="getSourceTypeMeta(store.result.bestOption.sourceType).type" effect="light" round>
              {{ getSourceTypeMeta(store.result.bestOption.sourceType).label }}
            </el-tag>
          </div>
        </template>

        <div class="best-option-topline">
          <div>
            <div class="train-line">
              <strong>{{ store.result.bestOption.trainCode }}</strong>
              <span>{{ store.result.bestOption.actualFrom }} → {{ store.result.bestOption.actualTo }}</span>
            </div>
            <p class="reason-text">{{ store.result.bestOption.recommendationReason }}</p>
          </div>
          <div class="price-block">
            <span>票价</span>
            <strong>¥{{ store.result.bestOption.price.toFixed(1) }}</strong>
          </div>
        </div>

        <el-descriptions :column="1" border class="result-descriptions">
          <el-descriptions-item label="购票区间">
            {{ store.result.bestOption.purchaseFrom }} → {{ store.result.bestOption.purchaseTo }}
          </el-descriptions-item>
          <el-descriptions-item label="实际乘坐">
            {{ store.result.bestOption.actualFrom }} → {{ store.result.bestOption.actualTo }}
          </el-descriptions-item>
          <el-descriptions-item label="席别">
            {{ store.result.bestOption.seatLabel }}
          </el-descriptions-item>
          <el-descriptions-item label="出发时间">
            {{ store.result.bestOption.departureTime }}
          </el-descriptions-item>
          <el-descriptions-item label="到达时间">
            {{ store.result.bestOption.arrivalTime }}
          </el-descriptions-item>
          <el-descriptions-item label="总耗时">
            {{ formatDuration(store.result.bestOption.actualRideDurationMinutes) }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card v-if="store.result?.candidates?.length" shadow="hover" class="candidate-card">
        <template #header>
          <div class="section-header">
            <div>
              <h2>候选方案</h2>
              <p>展示前 10 条可选方案，方便快速比较</p>
            </div>
            <el-tag type="info" effect="light" round>{{ topCandidates.length }} 条</el-tag>
          </div>
        </template>

        <div class="candidate-list">
          <article
            v-for="candidate in topCandidates"
            :key="candidate.trainNo + candidate.purchaseFrom + candidate.purchaseTo + candidate.seatCategory"
            class="candidate-item"
          >
            <div class="candidate-main">
              <div class="candidate-line">
                <strong>{{ candidate.trainCode }}</strong>
                <el-tag size="small" :type="getSourceTypeMeta(candidate.sourceType).type" effect="plain">
                  {{ getSourceTypeMeta(candidate.sourceType).label }}
                </el-tag>
              </div>
              <p>{{ candidate.purchaseFrom }} → {{ candidate.purchaseTo }}</p>
              <span>{{ candidate.seatLabel }} · {{ formatDuration(candidate.actualRideDurationMinutes) }}</span>
            </div>
            <div class="candidate-side">
              <strong>¥{{ candidate.price.toFixed(1) }}</strong>
              <span>{{ candidate.departureTime }} - {{ candidate.arrivalTime }}</span>
            </div>
          </article>
        </div>
      </el-card>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { CandidateSourceType } from '@train-ticket/core';
import {
  loadStationSnapshot,
  refreshStationSnapshot,
  shouldRefreshStations,
} from '../services/stationRepository';
import { useTicketQueryStore } from '../stores/ticketQuery';

defineEmits<{
  showRules: [];
  selectDeparture: [];
  selectArrival: [];
}>();

const store = useTicketQueryStore();
const stationsLoading = ref(false);
const stationsError = ref('');

const travelDateValue = computed({
  get: () => store.input.travelDate,
  set: (value: string | undefined) => {
    store.input.travelDate = value ?? '';
  },
});

const topCandidates = computed(() => store.result?.candidates.slice(0, 10) ?? []);

function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

onMounted(async () => {
  await warmupStations();
});

async function warmupStations(): Promise<void> {
  stationsLoading.value = true;
  stationsError.value = '';

  try {
    const snapshot = await loadStationSnapshot();
    if (shouldRefreshStations(snapshot.updatedAt)) {
      try {
        await refreshStationSnapshot();
      } catch {
        if (!snapshot.stations.length) {
          throw new Error('站点缓存刷新失败');
        }
      }
    }
  } catch (error) {
    stationsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    stationsLoading.value = false;
  }
}

function getSourceTypeMeta(sourceType: CandidateSourceType): {
  label: string;
  type: 'success' | 'warning';
} {
  return sourceType === 'direct'
    ? { label: '直达', type: 'success' }
    : { label: '买长坐短', type: 'warning' };
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分钟`;
}
</script>
