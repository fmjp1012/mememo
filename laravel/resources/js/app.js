import './bootstrap';
import '../css/app.css';

//vue & route
import { createApp } from 'vue';

//component
import LoginHeader from '@/Components/LoginHeader.vue';
import LoginContainer from '@/Pages/Login/LoginContainer.vue';
import CardCreateContainer from '@/Pages/CardCreate/CardCreateContainer.vue';
import CardStudyContainer from '@/Pages/CardStudy/CardStudyContainer.vue';
import CardIndexContainer from '@/Pages/CardIndex/CardIndexContainer.vue';
import CardEditContainer from '@/Pages/CardEdit/CardEditContainer.vue';

const app = createApp({});
app.component('LoginHeader', LoginHeader);
app.component('LoginContainer', LoginContainer);
app.component('CardCreateContainer', CardCreateContainer);
app.component('CardStudyContainer', CardStudyContainer);
app.component('CardIndexContainer', CardIndexContainer);
app.component('CardEditContainer', CardEditContainer);

app.mount('#app');
