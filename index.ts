import { registerRootComponent } from 'expo';
import React from 'react';

import { CrashGuard, reportCrash } from './src/CrashGuard';

// The game is loaded inside try/catch so that an error while its modules initialise is shown on
// screen (see CrashGuard) instead of closing the app immediately.
let Root: React.ComponentType = () => null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Root = require('./App').default;
} catch (error) {
  reportCrash('Error while starting the game', error);
}

function Guarded() {
  return React.createElement(CrashGuard, null, React.createElement(Root));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => Guarded);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Guarded);
