import { registerRootComponent } from 'expo';
import App from '../App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It ensures that whether loading the app in Expo or a web export build,
// the React Native environment is initialized with App.tsx
registerRootComponent(App);
