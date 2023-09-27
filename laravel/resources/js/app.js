import "./bootstrap";
import "../css/app.css";

//vue & route
import { createApp } from "vue";

//component
import LoginContainer from "./Pages/Login/LoginContainer.vue";
import CardCreateContainer from "./Pages/CardCreate/CardCreateContainer.vue";
import CardStudyContainer from "./Pages/CardStudy/CardStudyContainer.vue";

const app = createApp({});
app.component("LoginContainer", LoginContainer);
app.component("CardCreateContainer", CardCreateContainer);
app.component("CardStudyContainer", CardStudyContainer);

app.mount("#app");
