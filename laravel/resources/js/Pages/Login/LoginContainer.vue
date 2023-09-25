<script>
import LoginGoogleButton from './LoginGoogleButton.vue'
import LoginGithubButton from './LoginGithubButton.vue'

export default {
  components: {
    LoginGoogleButton,
    LoginGithubButton,
  },
  data() {
    return {
    }
  }
}
</script>

<template>
  <div>
    <LoginGoogleButton />
    <LoginGithubButton />
  </div>
</template>

<style scoped>
</style>
