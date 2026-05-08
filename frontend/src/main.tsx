import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyThemeFromStorage } from '@/components/theme-toggle';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

applyThemeFromStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <App />
      <Toaster position="top-center" closeButton />
    </TooltipProvider>
  </StrictMode>,
);
