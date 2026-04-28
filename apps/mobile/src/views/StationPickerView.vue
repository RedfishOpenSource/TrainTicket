<template>
  <main class="station-picker-page">
    <header class="station-picker-header">
      <button type="button" class="station-picker-back" @click="$emit('back')">‹</button>
      <h1>车站选择</h1>
      <span class="station-picker-header-spacer" />
    </header>

    <div class="station-picker-searchbar">
      <span class="station-picker-search-icon">⌕</span>
      <input
        v-model="keyword"
        type="text"
        autocomplete="off"
        :placeholder="targetField === 'departure' ? '请输入（如：北京市/北京站/beijing/bj）' : '请输入（如：西安市/西安站/xian/xa）'"
        class="station-picker-search-input"
      />
    </div>

    <section class="station-picker-body">
      <template v-if="loading">
        <div class="station-picker-empty">正在加载车站数据...</div>
      </template>
      <template v-else-if="errorMessage">
        <div class="station-picker-empty">{{ errorMessage }}</div>
      </template>
      <template v-else>
        <div v-if="keyword" class="station-picker-results">
          <button
            v-for="item in searchResults"
            :key="item.cityValue"
            type="button"
            class="station-picker-result-item"
            @click="selectItem(item)"
          >
            {{ item.displayName }}
          </button>
          <div v-if="!searchResults.length" class="station-picker-empty">没有匹配的城市</div>
        </div>

        <template v-else>
          <section class="station-picker-hot-section">
            <div class="station-picker-section-header">
              <h2>热门车站</h2>
            </div>
            <div class="station-picker-hot-grid">
              <button
                v-for="item in dataset.hotStations"
                :key="item.cityValue"
                type="button"
                class="station-picker-hot-item"
                @click="selectItem(item)"
              >
                {{ item.displayName }}
              </button>
            </div>
          </section>

          <section class="station-picker-list-section">
            <div class="station-picker-tabs">
              <span class="station-picker-tab station-picker-tab--active">国内站点</span>
              <span class="station-picker-tab">国际站点</span>
            </div>

            <div class="station-picker-groups">
              <section
                v-for="group in dataset.groups"
                :key="group.letter"
                :id="`station-group-${group.letter}`"
                class="station-picker-group"
              >
                <h3>{{ group.letter }}</h3>
                <button
                  v-for="item in group.items"
                  :key="item.cityValue"
                  type="button"
                  class="station-picker-group-item"
                  @click="selectItem(item)"
                >
                  {{ item.displayName }}
                </button>
              </section>
            </div>
          </section>

          <nav class="station-picker-index">
            <a
              v-for="letter in dataset.indexLetters"
              :key="letter"
              :href="`#station-group-${letter}`"
            >
              {{ letter }}
            </a>
          </nav>
        </template>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  buildStationPickerDataset,
  searchStationPickerItems,
  type StationPickerDataset,
  type StationPickerItem,
} from '../services/stationPicker';
import { loadStationSnapshot, refreshStationSnapshot, shouldRefreshStations } from '../services/stationRepository';

const props = defineProps<{
  targetField: 'departure' | 'arrival';
  visible?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  selectStation: [cityName: string];
}>();

const loading = ref(false);
const errorMessage = ref('');
const keyword = ref('');
const dataset = ref<StationPickerDataset>({
  hotStations: [],
  groups: [],
  indexLetters: [],
});

const searchResults = computed(() => searchStationPickerItems(dataset.value.groups, keyword.value));

onMounted(async () => {
  await loadStations();
});

watch(
  () => props.visible,
  async (visible) => {
    if (visible && (errorMessage.value || !dataset.value.groups.length)) {
      await loadStations();
    }
  },
);

async function loadStations(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    const snapshot = await loadStationSnapshot();
    dataset.value = buildStationPickerDataset(snapshot.stations);

    if (shouldRefreshStations(snapshot.updatedAt)) {
      try {
        const refreshedSnapshot = await refreshStationSnapshot();
        dataset.value = buildStationPickerDataset(refreshedSnapshot.stations);
      } catch {
        if (!dataset.value.groups.length) {
          throw new Error('站点数据刷新失败');
        }
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function selectItem(item: StationPickerItem): void {
  emit('selectStation', item.cityValue);
}
</script>
