<template>
  <div class="card-container">
    <p class="title">{{ title }}</p>
    <div class="input-container">
      <textarea name="input" />
    </div>
  </div>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      required: true,
    },
    card: {
      type: Object,
      required: false,
      default: () => {},
    },
  },
  data() {
    return {};
  },
};
</script>
<style scoped>
.card-container {
  width: 500px;
  height: 300px;
  border-radius: 0px 0px 10px 10px;
  background-color: #fff;
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
}

#input {
  width: 100%;
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
