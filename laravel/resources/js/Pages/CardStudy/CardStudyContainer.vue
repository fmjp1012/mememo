<template>
  <header-component />
  <div class="container">
    <CardComponent :title="state" />
    <div class="interface">
      <button v-if="state === 'question'" class="show-answer-btn">Answer</button>
      <div v-if="state === answer" class="rank">
      </div>
    </div>
  </div>
</template>

<script>
import HeaderComponent from '../../Components/HeaderComponent.vue';
import CardComponent from '../../Components/CardComponent.vue';

export default {
  components: {
    HeaderComponent,
    CardComponent
  },
  data() {
    return {
      state: 'question'
    }
  }
}
</script>
<style scoped>
.container {
  height: calc(100vh - 80px);
  background: #D9D9D9;
  gap: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
</style>
