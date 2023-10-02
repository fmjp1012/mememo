<template>
  <header>
    <div class="container">
      <div class="logo">
        <h1>mememo</h1>
      </div>
      <ul class="link">
        <li><a href="/card/create">Create</a></li>
        <li><a href="/card/study">Study</a></li>
        <li><a href="/card">List</a></li>
        <li><a href="/logout">Logout</a></li>
      </ul>
      <!-- <div class="avatar">
        <img
          class="profile-picture"
          :src="user.avatar"
          alt="profile-picture"
        />
      </div> -->
    </div>
  </header>
</template>

<script>
export default {
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

.link {
  display: flex;
  list-style: none;
}
.link li {
  margin-left: 10px;
}
a {
  
  color: #fff;
}
</style>
