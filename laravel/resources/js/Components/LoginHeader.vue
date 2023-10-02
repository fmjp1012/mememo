<template>
  <header>
    <div class="container">
      <div class="logo">
        <h1>mememo</h1>
      </div>
    </div>
  </header>
</template>

<script>
export default {
  data() {
    return {};
  },
  created() {},
};
</script>
<style scoped>
.container {
  height: 80px;
  padding: 0px 100px;
  background-color: #fff;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #545f71;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}
.logo {
  color: #fff;
  font-size: 24px;
  font-weight: bold;
}
</style>
