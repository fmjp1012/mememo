<template>
  <header-component :user="user" />
  <div>
    <h1 class="page-title">My Cards</h1>
  </div>
  <div class="grid-container">
    <div
      v-for="card in cards"
      :key="card.id"
      class="card"
    >
      <card-component :card="card" />
      <button @click="editCard(card.id)">Update</button>
      <button @click="deleteCard(card.id)">Delete</button>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import HeaderComponent from "@/Components/HeaderComponent.vue";
import CardComponent from "@/Components/CardComponent.vue";

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
    propsCards: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      cards: this.propsCards,
    };
  },
  created() {
  },
  methods: {
    editCard(id) {
      window.location.href = `/card/${id}`;
    },
    async deleteCard(id) {
      try {
        await axios.delete(`/card/${id}`);
        alert("Deleted");
        this.cards = this.cards.filter((card) => card.id !== id);
      } catch (error) {
        alert("Error");
      }
    },
  },
};
</script>
<style scoped>
.page-title {
  text-align: center;
  margin: 16px 0;
}
.grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  justify-items: center;
  gap: 16px;
}
.card {
  text-align: center;
}
.card button {
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
