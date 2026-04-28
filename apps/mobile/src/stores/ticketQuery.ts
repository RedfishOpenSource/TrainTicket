import { defineStore } from 'pinia';
import { toErrorMessage, type QueryInput, type QueryRecommendationResult } from '@train-ticket/core';
import { queryBestTicket } from '../services/queryService';

function createDefaultInput(): QueryInput {
  return {
    travelDate: new Date().toISOString().slice(0, 10),
    departureCity: '北京',
    arrivalCity: '天津',
  };
}

export const useTicketQueryStore = defineStore('ticketQuery', {
  state: () => ({
    input: createDefaultInput(),
    result: null as QueryRecommendationResult | null,
    loading: false,
    errorMessage: '',
  }),
  actions: {
    swapCities() {
      const currentDeparture = this.input.departureCity;
      this.input.departureCity = this.input.arrivalCity;
      this.input.arrivalCity = currentDeparture;
    },
    async submitQuery() {
      this.loading = true;
      this.errorMessage = '';
      try {
        this.result = await queryBestTicket(this.input);
      } catch (error) {
        this.errorMessage = toErrorMessage(error);
      } finally {
        this.loading = false;
      }
    },
  },
});
