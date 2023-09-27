import "./bootstrap";
import "../css/app.css";

//vue & route
import { createApp } from "vue";

//component
import LoginContainer from "./Pages/Login/LoginContainer.vue";
import CardCreateContainer from "./Pages/CardCreate/CardCreateContainer.vue";
import CardStudyContainer from "./Pages/CardStudy/CardStudyContainer.vue";
import CardAllContainer from "./Pages/CardAll/CardAllContainer.vue";

const app = createApp({});
app.component("LoginContainer", LoginContainer);
app.component("CardCreateContainer", CardCreateContainer);
app.component("CardStudyContainer", CardStudyContainer);
app.component("CardAllContainer", CardAllContainer);

app.mount("#app");
