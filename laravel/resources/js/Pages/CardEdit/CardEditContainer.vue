<template>
  <header-component :user="user" />
  <div class="container">
    <div class="flex-container">
      <div class="card-container">
        <p class="title">Question</p>
        <div class="input-container">
          <textarea
            id="input"
            v-model="questionText"
            name="input"
          />
        </div>
      </div>
      <div class="card-container">
        <p class="title">Answer</p>
        <div class="input-container">
          <textarea
            id="input"
            v-model="answerText"
            name="input"
          />
        </div>
      </div>
    </div>
    <button
      class="update-btn"
      @click="handleUpdateClick"
    >
      Update
    </button>
  </div>
</template>

<script>
import axios from "axios";
import HeaderComponent from "@/Components/HeaderComponent.vue";

export default {
  components: {
    HeaderComponent,
  },
  props: {
    user: {
      type: Object,
      required: true,
    },
    card: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      questionText: this.card.question,
      answerText: this.card.answer,
    };
  },
  created() {},
  methods: {
    async handleUpdateClick() {
      try {
        await axios.put(`/card/${this.card.id}`, {
          question: this.questionText,
          answer: this.answerText,
        });
        alert("Card updated!");
        window.location.href = "/card";
      } catch (error) {
        alert("An error occurred while updating the card.");
      }
    },
  },
};
</script>
<style scoped>
.container {
  height: calc(100vh - 80px);
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

.input-container {
  width: 100%;
  height: calc(100% - 40px);
  border-radius: 0px 0px 10px 10px;
  display: flex;
  justify-content: center;
  align-items: center;
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
.update-btn {
  font-size: 24px;
  font-weight: 600;
  border: none;
  padding: 0px 16px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}
</style>
