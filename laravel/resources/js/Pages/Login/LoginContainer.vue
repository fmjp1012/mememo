<template>
  <header-component />
  <div class="max-container">
    <h1>Login Page</h1>
    <div class="login-container">
      <login-google-button />
      <login-github-button />
    </div>
  </div>
</template>

<script>
import HeaderComponent from '../../Components/HeaderComponent.vue'
import LoginGoogleButton from './LoginGoogleButton.vue'
import LoginGithubButton from './LoginGithubButton.vue'

export default {
  components: {
    HeaderComponent,
    LoginGoogleButton,
    LoginGithubButton
  },
  data () {
    return {
    }
  }
}
</script>

<style scoped>
.max-container {
  height: calc(100vh - 80px);
  background: #D9D9D9;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.login-container {
  display: flex;
  width: 500px;
  height: 500px;
  padding: 126px 50px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 50px;
  flex-shrink: 0;
  border-radius: 30px;
  background: #545F71;
  box-shadow: 0px 4px 4px 0px rgba(0, 0, 0, 0.25);
}
</style>
