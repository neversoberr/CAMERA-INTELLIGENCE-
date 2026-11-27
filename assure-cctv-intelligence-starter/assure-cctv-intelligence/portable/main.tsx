import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import Monitor from '@/components/monitor/Monitor';

createRoot(document.getElementById('root')!).render(<Monitor/>);
