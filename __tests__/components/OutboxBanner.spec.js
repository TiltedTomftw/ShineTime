// Render tests for the outbox banner: it subscribes to the outbox, stays quiet
// for normal quick sends, explains offline saves, surfaces failures, and lets
// the detailer dismiss a failure or retry.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockEmit = null;
let mockOnline = null;
const mockDismiss = jest.fn();
const mockFlush = jest.fn(() => Promise.resolve());
const idle = { pending: 0, entries: [], failures: [], sending: false };

jest.mock('../../src/services/outbox', () => ({
  outbox: {
    getState: () => idle,
    subscribe: (listener) => {
      mockEmit = listener;
      listener(idle);
      return () => {
        mockEmit = null;
      };
    },
    dismissFailure: (...a) => mockDismiss(...a),
  },
  subscribeOnline: (listener) => {
    mockOnline = listener;
    listener(true);
    return () => {};
  },
  flushOutbox: () => mockFlush(),
}));

import OutboxBanner from '../../src/components/OutboxBanner';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 34 },
};
const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <OutboxBanner />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockDismiss.mockReset();
  mockFlush.mockClear();
});
afterEach(() => jest.useRealTimers());

const emit = async (state) => {
  await act(async () => {
    mockEmit({ ...idle, ...state });
  });
};

describe('OutboxBanner', () => {
  it('renders nothing when everything is saved', async () => {
    await mount();
    expect(screen.queryByText(/./)).toBeNull();
  });

  it('stays quiet for a quick send, then explains a slow one', async () => {
    await mount();
    await emit({ pending: 1 });
    expect(screen.queryByText(/Sending/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    expect(screen.getByText('Sending 1 change…')).toBeTruthy();
  });

  it('explains offline saves in plain language', async () => {
    await mount();
    await act(async () => {
      mockOnline(false);
    });
    await emit({ pending: 2 });
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    expect(screen.getByText(/^Offline\. 2 changes saved on this phone/)).toBeTruthy();
  });

  it('shows a failure right away and can dismiss it', async () => {
    await mount();
    await emit({ failures: [{ id: 'f1', message: '#P1 is already open on another job.' }] });
    expect(screen.getByText("Couldn't save: #P1 is already open on another job.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Dismiss'));
    });
    expect(mockDismiss).toHaveBeenCalledWith('f1');
  });

  it('offers Retry now while online', async () => {
    await mount();
    await emit({ pending: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Retry now'));
    });
    expect(mockFlush).toHaveBeenCalled();
  });

  it('disappears once everything has sent', async () => {
    await mount();
    await emit({ pending: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    await emit({ pending: 0 });
    expect(screen.queryByText(/Sending/)).toBeNull();
  });
});
