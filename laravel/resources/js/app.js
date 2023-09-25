import "./bootstrap";
import "../css/app.css";

//vue & route
import { createApp } from "vue";

//component
import LoginContainer from "./Pages/Login/LoginContainer.vue";

const app = createApp({});
app.component("LoginContainer", LoginContainer);

app.mount("#app");
