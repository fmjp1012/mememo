<template>
  <div
    class="card-container"
    @click="handleClick"
  >
    <p class="title">{{ title }}</p>
    <div class="text-container">
      <p v-if="title==='Question'">{{ card.question }}</p>
      <p v-else-if="title==='Answer'">{{ card.answer }}</p>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    card: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      title: "Question",
      cardContent: this.card.question,
    };
  },
  methods: {
    handleClick() {
      this.title = this.title === "Question" ? "Answer" : "Question";
      this.cardContent =
        this.title === "Question"
          ? this.card.question
          : this.card.answer;
    },
  },
};
</script>
<style scoped>
.card-container {
  width: 500px;
  height: 300px;
  border-radius: 0px 0px 10px 10px;
  background-color: #fff;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}

.title {
  color: #fff;
  background-color: #545f71;
  font-family: Noto Sans;
  font-size: 24px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  text-align: center;
}

.text-container {
  width: 100%;
  height: calc(100% - 40px);
  border-radius: 0px 0px 10px 10px;
  display: flex;
  justify-content: center;
}

#input {
  width: 90%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  background: none;
  box-shadow: none;
  font-size: 1em;
  font-family: inherit;
  color: inherit;
  line-height: 1;
}
</style>
