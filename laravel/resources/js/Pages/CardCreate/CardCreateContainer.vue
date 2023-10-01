<template>
  <header-component :user="user" />
  <div class="container">
    <div class="flex-container">
      <CardInput
        mode="Create"
        title="Question"
        @input-change="handleQuestionInputChange"
      />
      <CardInput
        mode="Create"
        title="Answer"
        @input-change="handleAnswerInputChange"
      />
    </div>
    <button class="create-btn">create</button>
  </div>
</template>

<script>
import HeaderComponent from "@/Components/HeaderComponent.vue";
import CardInput from "@/Components/CardInput.vue";

export default {
  components: {
    HeaderComponent,
    CardInput,
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
