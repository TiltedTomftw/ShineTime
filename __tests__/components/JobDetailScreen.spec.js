// Render tests for the job screen — the screen detailers live on. Services are
// mocked at the module boundary; the job-state rules themselves are covered by
// jobLogic's unit tests.

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockFetchJob = jest.fn();
const mockPerform = jest.fn();
let mockIsManager = false;

jest.mock('../../src/services/jobs', () => ({
  fetchJob: (...a) => mockFetchJob(...a),
  performJobAction: (...a) => mockPerform(...a),
  addJobPhoto: jest.fn(),
}));
jest.mock('../../src/services/outbox', () => ({
  outbox: { subscribe: () => () => {}, pendingFor: () => [] },
}));
jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ isManager: mockIsManager }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
}));
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 0 }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-haptics', () => ({
  notificationAsync: () => Promise.resolve(),
  NotificationFeedbackType: { Success: 'success' },
}));

import JobDetailScreen from '../../src/screens/JobDetailScreen';

const NOW = Date.now();
const baseJob = (over = {}) => ({
  jobId: 'job_1',
  stockNumber: 'P4521',
  year: '2022',
  make: 'Ford',
  model: 'F-150',
  color: 'Blue',
  status: 'in_progress',
  detailerName: 'Mike',
  startTime: NOW - (3600000 + 24 * 60000 + 7000),
  totalPauseTime: 0,
  pauseEvents: [],
  notes: [],
  custodyEvents: [{ type: 'start', timestamp: NOW - 3600000, detailerName: 'Mike' }],
  detailerTimeTracking: {},
  ...over,
});

const navigation = { setOptions: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mount = async (job) => {
  mockFetchJob.mockResolvedValue({ job, photos: [], offline: false });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <JobDetailScreen route={{ params: { jobId: 'job_1' } }} navigation={navigation} />
    </SafeAreaProvider>,
  );
  await act(async () => {});
};

const press = async (text) => {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
};

beforeEach(() => {
  mockIsManager = false;
  mockFetchJob.mockReset();
  mockPerform.mockReset();
  navigation.navigate.mockReset();
  mockPerform.mockImplementation(async (job, type) => ({
    ...job,
    status: type === 'pause' ? 'paused' : type === 'complete' ? 'completed' : 'in_progress',
    totalActiveTime: 3600000,
  }));
});

describe('JobDetailScreen', () => {
  it('leads with a ticking H:MM:SS timer and the running state', async () => {
    await mount(baseJob());
    expect(screen.getByText(/^1:24:0\d$/)).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
  });

  it('pauses with a tapped reason and no "Success" pop-up', async () => {
    await mount(baseJob());
    await press('Pause');
    expect(screen.getByText('Why are you pausing?')).toBeTruthy();
    await press('Sold unit came in');
    await press('Pause job');
    expect(mockPerform).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job_1' }), 'pause', {
      reason: 'Sold unit came in',
      note: '',
    });
    expect(screen.getByText('Paused')).toBeTruthy();
  });

  it('completing shows a summary, nudges for photos, and lands on Home with a confirmation', async () => {
    await mount(baseJob());
    await press('Complete');
    expect(screen.getByText('Finish #P4521?')).toBeTruthy();
    expect(screen.getByText(/No photos yet/)).toBeTruthy();
    await press('Complete job');
    expect(navigation.navigate).toHaveBeenCalledWith('Home', {
      justCompleted: { stock: 'P4521', durationMs: 3600000 },
    });
  });

  it("shows the manager's rework note and a Start rework action", async () => {
    await mount(
      baseJob({
        status: 'needs_rework',
        custodyEvents: [
          { type: 'complete', timestamp: NOW - 7200000, detailerName: 'Mike' },
          {
            type: 'rework',
            timestamp: NOW - 600000,
            detailerName: 'Dana',
            note: 'Swirl marks on hood',
          },
        ],
      }),
    );
    expect(screen.getByText(/^Sent back: .Swirl marks on hood. — Dana$/)).toBeTruthy();
    await press('Start rework');
    expect(mockPerform).toHaveBeenCalledWith(expect.anything(), 'resume', undefined);
  });

  it('keeps Pause and Complete on screen while a note saves', async () => {
    let finish;
    mockPerform.mockImplementationOnce(
      (job) =>
        new Promise((resolve) => {
          finish = () => resolve({ ...job, notes: [{ text: 'odor', timestamp: NOW }] });
        }),
    );
    await mount(baseJob());
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Note'), 'odor');
    });
    await press('Add note');
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    await act(async () => finish());
    expect(screen.getByText('odor')).toBeTruthy();
  });

  it('lets a manager work their own car like anyone else', async () => {
    mockIsManager = true;
    await mount(baseJob());
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.queryByText(/View only/)).toBeNull();
  });

  it('says so plainly when the job is gone', async () => {
    await mount(null);
    expect(screen.getByText('This job is no longer available')).toBeTruthy();
  });
});
