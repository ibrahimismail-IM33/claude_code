import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/map.css';
import './styles/dashboard.css';
// LAST in the chain, and deliberately so: the record card's print rules must
// win, and several of them sit at the same specificity as screen rules.
import './styles/kad-rekod.css';

createApp(App).use(createPinia()).mount('#app');
