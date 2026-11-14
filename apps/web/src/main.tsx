import { render } from 'preact';
import './ui/win95.css';
import { App } from './app/App.js';
import { controller } from './app/controller.js';
import { mockSource } from './mocks/mockCases.js';

// Frontend-only MOCK samples (primitive shapes, labelled "MOCK — NOT ANATOMY"). Remove this line
// to ship without them; real cases always come from the hub's case packs.
controller.registerLocal(mockSource);
controller.start();
render(<App />, document.getElementById('root')!);
