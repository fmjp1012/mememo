<template>
  <header>
    <div class="container">
      <div class="logo"></div>
      <div v-if="mode === 'card'" class="tab"></div>
      <div v-if="mode === 'card'" class="avatar">
        <img class="profile-picture" :src="user.avatar" alt="profile-picture">
      </div>
    </div>
  </header>
</template>

<script>
export default {
  props: {
    mode: {
      type: String,
      required: true
    },
    user: {
      type: Object,
      default: () => {},
      required: false
    }
  },
  data() {
    return {
    }
  }
}
</script>
<style scoped>
.container {
  height: 80px;
  padding: 0px 100px;
  background-color: #fff;
  border-bottom: 1px solid #ccc;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-direction: column;
  background: #545F71;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}
</style>
