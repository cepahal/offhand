/** Offhand: the dental CBCT review workstation is the only screen. */
import { render } from 'preact';
import { DentalView } from './demo/DentalView.js';
import './demo/dental-view.css';

const root = document.getElementById('root');
if (root) render(<DentalView />, root);
