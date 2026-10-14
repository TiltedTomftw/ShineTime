// Render tests for the detailer home: it must lead with the cars they're
// working on, put rework where it can't be missed, and resume in one tap.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockFetchOpen = jest.fn();
const mockPerform = jest.fn();
let mockIsManager = false;

jest.mock('../../src/services/jobs', () => ({
  fetchOpenJobs: (...a) => mockFetchOpen(...a),
  fetchTodayStats: () => Promise.resolve({ completed: 3, totalMs: 9720000, avgMs: 3240000 }),
  performJobAction: (...a) => mockPerform(...a),
}));
jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    userName: 'Mike Smith',
    activeDealership: { dealershipId: 'd1', dealership: { name: 'Ford Motors' } },
    isManager: mockIsManager,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
}));

import HomeScreen from '../../src/screens/HomeScreen';

const NOW = Date.now();
const job = (id, status, over = {}) => ({
  jobId: id,
  stockNumber: id.toUpperCase(),
  status,
  detailerName: 'Mike Smith',
  startTime: NOW - 600000,
  totalPauseTime: 0,
  pauseEvents:
    status === 'paused' ? [{ type: 'pause', timestamp: NOW - 60000, reason: 'Lunch / break' }] : [],
  custodyEvents: [],
  ...over,
});

const navigation = { navigate: jest.fn(), setParams: jest.fn() };
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mount = async (jobs, params = {}) => {
  mockFetchOpen.mockResolvedValue({ jobs, offline: false });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <HomeScreen navigation={navigation} route={{ params }} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  mockIsManager = false;
  navigation.navigate.mockReset();
  mockPerform.mockReset();
});

describe('HomeScreen (detailer)', () => {
  it("leads with the scan action and the detailer's own cars", async () => {
    await mount([job('p1', 'in_progress'), job('p2', 'paused')]);
    expect(screen.getByText("Mike's cars")).toBeTruthy();
    expect(screen.getByText('Scan keytag')).toBeTruthy();
    expect(screen.getByText('Working now · 2')).toBeTruthy();
    expect(screen.getByText('#P1')).toBeTruthy();
    expect(screen.getByText(/Lunch \/ break/)).toBeTruthy();
  });

  it('puts cars sent back for rework in their own section', async () => {
    await mount([
      job('r1', 'needs_rework', {
        custodyEvents: [
          { type: 'rework', note: 'Swirl marks', detailerName: 'Dana', timestamp: NOW },
        ],
      }),
    ]);
    expect(screen.getByText('Sent back for rework · 1')).toBeTruthy();
    expect(screen.getByText(/Swirl marks/)).toBeTruthy();
  });

  it('resumes a paused car in one tap and opens it', async () => {
    const paused = job('p2', 'paused');
    mockPerform.mockResolvedValue({ ...paused, status: 'in_progress' });
    await mount([paused]);
    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });
    expect(mockPerform).toHaveBeenCalledWith(paused, 'resume');
    expect(navigation.navigate).toHaveBeenCalledWith('JobDetail', { jobId: 'p2' });
  });

  it("shows today's numbers, not all-time", async () => {
    await mount([]);
    expect(screen.getByText(/^Today: 3 done · avg 54 min$/)).toBeTruthy();
    expect(screen.getByText('No cars in progress')).toBeTruthy();
  });

  it('confirms a just-completed car', async () => {
    await mount([], { justCompleted: { stock: 'P9', durationMs: 3120000 } });
    expect(screen.getByText('Done: #P9 · 52 min')).toBeTruthy();
  });

  it('keeps sign-out off the home screen', async () => {
    await mount([]);
    expect(screen.queryByText(/Log ?Out|Sign out/i)).toBeNull();
    expect(screen.getByLabelText('Account and sign out')).toBeTruthy();
  });
});

describe('HomeScreen (manager)', () => {
  it('gives managers the same my-cars home; manager tools live on the web dashboard', async () => {
    mockIsManager = true;
    await mount([job('p1', 'in_progress')]);
    expect(screen.getByText("Mike's cars")).toBeTruthy();
    expect(screen.getByText('Scan keytag')).toBeTruthy();
    expect(screen.queryByText('Shop floor')).toBeNull();
    expect(screen.queryByText(/Invite team/)).toBeNull();
  });
});
