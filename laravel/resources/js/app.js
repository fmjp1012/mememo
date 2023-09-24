import "./bootstrap";
import "../css/app.css";

//vue & route
import { createApp } from "vue";

//component
// import TopIndex from "./componen/Top/TopIndex.vue";
import Test from "./components/Test.vue";


const app = createApp({});
app.component("Test", Test);

app.mount("#app");
