// Render tests for the sync banner.
//
// This is the one piece of UI whose behaviour can't be proved by unit tests:
// it subscribes to storage's sync status and conditionally renders. The message
// wording is already covered by describeSyncStatus's unit tests — what's proved
// here is the wiring: that it really subscribes, re-renders on a status change,
// and unsubscribes on unmount.
//
// Note: @testing-library/react-native v14 has an ASYNC render/unmount API.

import React from 'react';
import { render, screen, act } from '@testing-library/react-native';

// Mock the storage module boundary so we don't drag in AsyncStorage/Supabase,
// and so the test drives the status directly.
let emit = null;
let unsubscribed = false;

jest.mock('../../src/services/storage', () => ({
  subscribeSyncStatus: (listener) => {
    emit = listener;
    listener({ pendingCount: 0, lastError: null }); // fires immediately, like the real one
    return () => {
      unsubscribed = true;
    };
  },
}));

import SyncStatusBanner from '../../src/components/SyncStatusBanner';

const push = async (status) => {
  await act(async () => {
    emit(status);
  });
};

beforeEach(() => {
  emit = null;
  unsubscribed = false;
});

describe('SyncStatusBanner', () => {
  it('renders nothing while everything is synced', async () => {
    await render(<SyncStatusBanner />);
    expect(screen.toJSON()).toBeNull();
  });

  it('subscribes to sync status on mount', async () => {
    await render(<SyncStatusBanner />);
    expect(typeof emit).toBe('function');
  });

  it('shows a warning once writes are pending', async () => {
    await render(<SyncStatusBanner />);
    await push({ pendingCount: 2, lastError: null });
    expect(screen.getByText(/2 changes not saved to the server yet/i)).toBeTruthy();
  });

  it('uses the singular for a single pending change', async () => {
    await render(<SyncStatusBanner />);
    await push({ pendingCount: 1, lastError: null });
    expect(screen.getByText(/1 change not saved/i)).toBeTruthy();
  });

  it('surfaces a sync error when nothing is queued', async () => {
    await render(<SyncStatusBanner />);
    await push({ pendingCount: 0, lastError: 'Network request failed' });
    expect(screen.getByText(/Network request failed/)).toBeTruthy();
  });

  it('disappears again once the queue drains', async () => {
    await render(<SyncStatusBanner />);
    await push({ pendingCount: 3, lastError: null });
    expect(screen.toJSON()).not.toBeNull();

    await push({ pendingCount: 0, lastError: null });
    expect(screen.toJSON()).toBeNull();
  });

  it('does not block touches on the screen behind it', async () => {
    await render(<SyncStatusBanner />);
    await push({ pendingCount: 1, lastError: null });
    expect(screen.toJSON().props.pointerEvents).toBe('none');
  });

  it('unsubscribes on unmount (no leak, no setState after teardown)', async () => {
    const view = await render(<SyncStatusBanner />);
    await view.unmount();
    expect(unsubscribed).toBe(true);
  });
});
