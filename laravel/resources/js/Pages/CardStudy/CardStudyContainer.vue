<template>
  <header-component />
  <div class="container">
    <CardComponent :title="state" />
    <div class="interface">
      <button v-if="state === 'Question'" class="show-answer-btn">
        Answer
      </button>
      <div v-if="state === answer" class="rank"></div>
    </div>
  </div>
</template>

<script>
import HeaderComponent from '../../Components/HeaderComponent.vue';
import CardComponent from '../../Components/CardComponent.vue';

export default {
  components: {
    HeaderComponent,
    CardComponent,
  },
  props: {
    user: {
      type: Object,
      required: true,
    },
    cards: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      state: 'Question',
    };
  },
};
</script>
<style scoped>
.container {
  height: calc(100vh - 80px);
  background: #d9d9d9;
  gap: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
</style>
