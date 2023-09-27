<template>
  <header-component />
  <div class="container">
    <div class="flex-container">
      <CardComponent title="question" />
      <CardComponent title="answer" />
   </div>
    <button class="create-btn">create</button>
  </div>
</template>

<script>
import HeaderComponent from '../../Components/HeaderComponent.vue'
import CardComponent from '../../Components/CardComponent.vue'

export default {
  components: {
    HeaderComponent,
    CardComponent
  },
  data() {
    return {
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
.flex-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 70px;
}
</style>
