<template>
  <div class="btn-container">
    <a class="btn" href="/login/google">
      <div class="logo"><img src="storage/images/google_logo.svg" alt="Google Logo" /></div>
      <div class="btn-title">Login with Google</div>
    </a>
  </div>
</template>

<script>
export default {
  data() {
    return {
    }
  }
}
</script>

<style scoped>
.btn-container {
  width: 255;
  height: 68px;
}

.btn {
  padding: 14px 12px;
  gap: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 20px;
  background: #FFF;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
  text-decoration: none;
}

.btn-title {
  color: #000;
  font-size: 20px;
  font-weight: 700;
}
</style>
