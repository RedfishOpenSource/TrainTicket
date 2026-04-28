<template>
  <TicketQueryView
    v-show="currentPage === 'query'"
    @show-rules="currentPage = 'rules'"
    @select-departure="openStationPicker('departure')"
    @select-arrival="openStationPicker('arrival')"
  />
  <RulesView v-show="currentPage === 'rules'" @back="currentPage = 'query'" />
  <StationPickerView
    v-show="currentPage === 'stationPicker'"
    :visible="currentPage === 'stationPicker'"
    :target-field="pickerTarget"
    @back="currentPage = 'query'"
    @select-station="handleSelectStation"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTicketQueryStore } from './stores/ticketQuery';
import TicketQueryView from './views/TicketQueryView.vue';
import RulesView from './views/RulesView.vue';
import StationPickerView from './views/StationPickerView.vue';

const store = useTicketQueryStore();
const currentPage = ref<'query' | 'rules' | 'stationPicker'>('query');
const pickerTarget = ref<'departure' | 'arrival'>('departure');

function openStationPicker(target: 'departure' | 'arrival'): void {
  pickerTarget.value = target;
  currentPage.value = 'stationPicker';
}

function handleSelectStation(cityName: string): void {
  if (pickerTarget.value === 'departure') {
    store.input.departureCity = cityName;
  } else {
    store.input.arrivalCity = cityName;
  }
  currentPage.value = 'query';
}
</script>
