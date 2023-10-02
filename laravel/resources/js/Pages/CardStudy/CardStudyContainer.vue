<template>
  <header-component :user="user" />
  <div class="container">
    <CardComponent
      :card="nowCard"
    />
    <button
      v-if="leftNum > 0"
      class="btn next-btn"
      @click="handleNextClick"
    >
      Next
    </button>
    <button
      v-else-if="leftNum === 0"
      class="btn finish-btn"
      @click="handleFinishClick"
    >
      Finish
    </button>
    <!-- <div class="interface"> -->
    <!-- <button
        v-if="state === 'Question'"
        class="show-answer-btn"
      >
        Answer
      </button> -->
    <!-- <div
        v-if="state === 'Answer'"
        class="rank"
      >
        <ol>
          <li>1</li>
          <li>2</li>
          <li>3</li>
          <li>4</li>
        </ol>
      </div> -->
    <!-- </div> -->
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
    cards: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      nowNum: 0,
      nowCard: this.cards[0],
      leftNum: this.cards.length-1,
    };
  },
  created() {
  },
  methods: {
    handleNextClick() {
      this.nowNum++;
      this.nowCard = this.cards[this.nowNum];
      this.leftNum--;
    },
    handleFinishClick() {
      window.location.href = "/card";
    },
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
.btn {
  margin: 8px;
  font-size: 16px;
  font-weight: 600;
  border: none;
  padding: 0px 16px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}
</style>
