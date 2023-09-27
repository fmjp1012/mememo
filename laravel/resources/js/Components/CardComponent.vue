<template>
  <div class="card-container">
    <p class="title">{{ title }}</p>
    <div class="input-container">
      <textarea id="input" name="input"></textarea>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      required: true
    }
  },
  data() {
    return {

    }
  }
}
</script>
<style scoped>
.card-container {
  width: 500px;
  height: 300px;
  border-radius: 0px 0px 10px 10px;
  background-color: #FFF;
}

.title {
  color: #FFF;
  background-color: #545F71;
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
  resize: none; /* ユーザーがリサイズできないようにする */
  background: none;
  box-shadow: none;
  font-size: 1em; /* フォントサイズを1emに設定 */
  font-family: inherit; /* 親要素からフォントファミリーを継承 */
  color: inherit; /* 親要素からテキストカラーを継承 */
  line-height: 1; /* ラインハイトを1に設定 */
}
</style>
