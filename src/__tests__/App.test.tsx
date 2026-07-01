// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import App from '../App';

// React Flow relies on ResizeObserver, which jsdom doesn't provide.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function postCompositeLoad(metadata: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'composite:load', state: {}, metadata },
    }));
  });
}

describe('App static mode initial tab', () => {
  afterEach(() => {
    cleanup();
    // Restore URL to plain root after each test so subsequent tests start clean.
    window.history.pushState({}, '', '/');
  });

  it('defaults to wiring canvas (not setup panel) when ?static=1', () => {
    // Use history.pushState — the idiomatic jsdom way to change location.search
    // without breaking the window.location object for subsequent tests.
    window.history.pushState({}, '', '?static=1');
    render(<App />);

    // Load a composite so the app exits its early "Waiting for composite…" guard
    // and renders the full tab layout. Without this, state===null causes an early
    // return that skips all panels, making tab assertions vacuous.
    postCompositeLoad({ id: 'test.composites.demo', name: 'demo' });

    // SetupRunPanel is only mounted when tab==='setup'.
    // In static mode, with our fix, tab initialises to 'wiring', so SetupRunPanel
    // is absent — its Run button and Steps label must not exist in the DOM.
    expect(screen.queryByRole('button', { name: /^Run$/i })).toBeNull();
    expect(screen.queryByLabelText(/^Steps/i)).toBeNull();

    // Positive assertion: the wiring canvas wrapper has display:flex (active tab).
    // App renders: `display: tab === 'wiring' ? 'flex' : 'none'` on the canvas div.
    // Without the fix tab would be 'setup' → display:none → the assertion below fails.
    const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div[style]'));
    const wiringActive = allDivs.some(
      (el) => el.style.display === 'flex' && el.style.position === 'absolute',
    );
    expect(wiringActive).toBe(true);
  });
});

describe('App top bar', () => {
  it('shows the composite name and library from composite:load metadata', async () => {
    render(<App />);
    postCompositeLoad({
      id: 'pbg_biomodels.composites.compare-biomodel',
      name: 'compare-biomodel',
      library: 'pbg_biomodels',
    });
    expect(await screen.findByText('compare-biomodel')).toBeTruthy();
    expect(screen.getByText('pbg_biomodels')).toBeTruthy();
  });
});
