<template>
  <header-component :user="user" />
  <div class="container">
    <div class="flex-container">
      <CardComponent
        mode="Create"
        title="Question"
        @input-change="handleQuestionInputChange"
      />
      <CardComponent
        mode="Create"
        title="Answer"
        @input-change="handleAnswerInputChange"
      />
    </div>
    <button class="create-btn">create</button>
  </div>
</template>

<script>
import HeaderComponent from "../../Components/HeaderComponent.vue";
import CardComponent from "../../Components/CardComponent.vue";

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
  },
  data() {
    return {};
  },
  created() {},
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

.flex-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 70px;
}
</style>
